/**
 * Lambda Tenant Management handler.
 *
 * Only superadmin users (Cognito group "superadmin") can call these.
 *
 * Routes:
 *   GET    /tenants                       → list all tenants
 *   POST   /tenants                       → create tenant
 *   GET    /tenants/{tenantId}            → get tenant details
 *   PUT    /tenants/{tenantId}            → update tenant
 *   DELETE /tenants/{tenantId}            → delete tenant
 *   GET    /tenants/{tenantId}/users      → list tenant users
 *   POST   /tenants/{tenantId}/users      → create user for tenant
 *   DELETE /tenants/{tenantId}/users/{userId} → delete tenant user
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminAddUserToGroupCommand,
  AdminSetUserPasswordCommand,
  AdminListGroupsForUserCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

// ── TEST PASSWORD (remove before production!) ────────────────────
const TEST_PASSWORD = "FWvuLPnRY~B#cAVX1";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const cognito = new CognitoIdentityProviderClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const USER_POOL_ID = process.env.USER_POOL_ID;

// ── JWT helpers ──────────────────────────────────────────────────

function decodeJwt(event) {
  const authHeader =
    event.headers?.Authorization || event.headers?.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return {};
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  } catch {
    return {};
  }
}

function isSuperadmin(event) {
  const jwt = decodeJwt(event);
  const groups = jwt["cognito:groups"] || [];
  return groups.includes("superadmin");
}

// ── Response helper ──────────────────────────────────────────────

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Api-Key,X-Tenant-Id",
    },
    body: JSON.stringify(body),
  };
}

// ── DynamoDB keys for tenants ────────────────────────────────────

function tenantPK(tenantId) {
  return `TENANT#${tenantId}`;
}
const TENANT_SK = "METADATA";

// ── Tenant CRUD ──────────────────────────────────────────────────

async function createTenant(body) {
  if (!body?.id || !body?.name || !body?.contactEmail) {
    return response(400, { error: "Missing required fields: id, name, contactEmail" });
  }

  const tenantId = body.id.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const now = new Date().toISOString();

  // Check if tenant ID already exists
  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: tenantPK(tenantId), SK: TENANT_SK },
      ProjectionExpression: "PK",
    })
  );

  if (existing.Item) {
    return response(409, { error: `Firma o ID '${tenantId}' już istnieje` });
  }

  // Check if contactEmail is already used by another tenant
  const allTenants = await ddb.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "SK = :sk AND contactEmail = :email",
      ExpressionAttributeValues: {
        ":sk": TENANT_SK,
        ":email": body.contactEmail,
      },
      ProjectionExpression: "tenantId, contactEmail",
    })
  );

  if (allTenants.Items && allTenants.Items.length > 0) {
    const existingTenant = allTenants.Items[0].tenantId;
    return response(409, {
      error: `Email '${body.contactEmail}' jest już przypisany do firmy '${existingTenant}'`,
    });
  }

  // Check if email already exists as a Cognito user
  try {
    const existingUsers = await cognito.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Filter: `email = "${body.contactEmail}"`,
        Limit: 1,
      })
    );
    if (existingUsers.Users && existingUsers.Users.length > 0) {
      return response(409, {
        error: `Konto użytkownika '${body.contactEmail}' już istnieje w systemie`,
      });
    }
  } catch (err) {
    console.error(`[Tenants] Error checking existing user: ${err.message}`);
    // Continue — Cognito will catch duplicates anyway
  }

  const item = {
    PK: tenantPK(tenantId),
    SK: TENANT_SK,
    tenantId,
    name: body.name,
    contactEmail: body.contactEmail || null,
    notes: body.notes || null,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  // Auto-create Cognito user if contactEmail is provided
  let createdUser = null;
  if (body.contactEmail) {
    try {
      const createResult = await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: body.contactEmail,
          UserAttributes: [
            { Name: "email", Value: body.contactEmail },
            { Name: "email_verified", Value: "true" },
            { Name: "custom:tenantId", Value: tenantId },
          ],
          TemporaryPassword: TEST_PASSWORD,
          MessageAction: "SUPPRESS",
        })
      );

      // Set password as permanent
      await cognito.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: USER_POOL_ID,
          Username: body.contactEmail,
          Password: TEST_PASSWORD,
          Permanent: true,
        })
      );

      createdUser = {
        email: body.contactEmail,
        username: createResult.User.Username,
        status: "CONFIRMED",
      };
      console.log(`[Tenants] Auto-created user ${body.contactEmail} for tenant ${tenantId}`);
    } catch (err) {
      if (err.name === "UsernameExistsException") {
        console.log(`[Tenants] User ${body.contactEmail} already exists, skipping auto-create`);
      } else {
        console.error(`[Tenants] Failed to auto-create user: ${err.message}`);
      }
    }
  }

  return response(201, {
    message: "Tenant created",
    tenant: item,
    ...(createdUser ? { user: createdUser } : {}),
  });
}

async function getTenant(tenantId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: tenantPK(tenantId), SK: TENANT_SK },
    })
  );

  if (!result.Item) {
    return response(404, { error: `Tenant '${tenantId}' not found` });
  }

  const { PK, SK, ...tenant } = result.Item;

  // Count batteries
  const batteries = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": tenantPK(tenantId),
        ":prefix": "BATTERY#",
      },
      Select: "COUNT",
    })
  );

  tenant.batteryCount = batteries.Count || 0;

  return response(200, { tenant });
}

async function listTenants() {
  // Scan for all METADATA records
  const result = await ddb.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "SK = :sk",
      ExpressionAttributeValues: { ":sk": TENANT_SK },
    })
  );

  const tenants = (result.Items || []).map(({ PK, SK, ...rest }) => rest);
  tenants.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return response(200, { tenants, count: tenants.length });
}

async function updateTenant(tenantId, body) {
  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: tenantPK(tenantId), SK: TENANT_SK },
    })
  );

  if (!existing.Item) {
    return response(404, { error: `Tenant '${tenantId}' not found` });
  }

  const now = new Date().toISOString();
  const item = {
    ...existing.Item,
    name: body.name || existing.Item.name,
    contactEmail: body.contactEmail ?? existing.Item.contactEmail,
    notes: body.notes ?? existing.Item.notes,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  const { PK, SK, ...tenant } = item;
  return response(200, { message: "Tenant updated", tenant });
}

async function deleteTenant(tenantId) {
  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: tenantPK(tenantId), SK: TENANT_SK },
      ProjectionExpression: "PK",
    })
  );

  if (!existing.Item) {
    return response(404, { error: `Tenant '${tenantId}' not found` });
  }

  // Check if they have batteries
  const batteries = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": tenantPK(tenantId),
        ":prefix": "BATTERY#",
      },
      Select: "COUNT",
    })
  );

  if (batteries.Count > 0) {
    return response(400, {
      error: `Cannot delete tenant '${tenantId}' — has ${batteries.Count} batteries. Delete them first.`,
    });
  }

  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: tenantPK(tenantId), SK: TENANT_SK },
    })
  );

  return response(200, { message: `Tenant '${tenantId}' deleted` });
}

// ── User management ──────────────────────────────────────────────

async function createTenantUser(tenantId, body) {
  if (!body?.email) {
    return response(400, { error: "Missing required field: email" });
  }

  // Verify tenant exists
  const tenant = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: tenantPK(tenantId), SK: TENANT_SK },
      ProjectionExpression: "PK, #n",
      ExpressionAttributeNames: { "#n": "name" },
    })
  );

  if (!tenant.Item) {
    return response(404, { error: `Tenant '${tenantId}' not found` });
  }

  try {
    // Create user in Cognito with test password (suppress email)
    const result = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: body.email,
        UserAttributes: [
          { Name: "email", Value: body.email },
          { Name: "email_verified", Value: "true" },
          { Name: "custom:tenantId", Value: tenantId },
          ...(body.givenName
            ? [{ Name: "given_name", Value: body.givenName }]
            : []),
          ...(body.familyName
            ? [{ Name: "family_name", Value: body.familyName }]
            : []),
        ],
        TemporaryPassword: TEST_PASSWORD,
        MessageAction: "SUPPRESS",
      })
    );

    // Set password as permanent so user doesn't have to change it
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: body.email,
        Password: TEST_PASSWORD,
        Permanent: true,
      })
    );

    const user = result.User;
    return response(201, {
      message: `User created for tenant '${tenantId}' with test password`,
      user: {
        username: user.Username,
        email: body.email,
        tenantId,
        status: "CONFIRMED",
      },
    });
  } catch (err) {
    if (err.name === "UsernameExistsException") {
      return response(409, { error: `User '${body.email}' already exists` });
    }
    throw err;
  }
}

async function listTenantUsers(tenantId) {
  // List Cognito users with custom:tenantId = tenantId
  const result = await cognito.send(
    new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `\"custom:tenantId\" = \"${tenantId}\"`,
    })
  );

  const users = (result.Users || []).map((u) => {
    const attrs = {};
    for (const a of u.Attributes || []) {
      attrs[a.Name] = a.Value;
    }

    // Determine if email invitation was sent:
    // If user status is FORCE_CHANGE_PASSWORD, Cognito sent an email with temp password.
    // If status is CONFIRMED (and we used SUPPRESS + AdminSetUserPassword), no email was sent.
    const status = u.UserStatus;
    const emailVerified = attrs.email_verified === "true";

    // Heuristic: if SUPPRESS was used, user would go FORCE_CHANGE_PASSWORD -> CONFIRMED
    // via AdminSetUserPassword(Permanent=true) without any email.
    // If no SUPPRESS, user would get email with temp password and be in FORCE_CHANGE_PASSWORD.
    const emailSent = status === "FORCE_CHANGE_PASSWORD";

    return {
      username: u.Username,
      email: attrs.email || "",
      tenantId: attrs["custom:tenantId"] || "",
      givenName: attrs.given_name || "",
      familyName: attrs.family_name || "",
      status,
      enabled: u.Enabled,
      emailVerified,
      emailSent,
      createdAt: u.UserCreateDate?.toISOString() || null,
      lastModifiedAt: u.UserLastModifiedDate?.toISOString() || null,
      lastLoginAt: null,
    };
  });

  // Get last auth date for each user (AdminGetUser has more detail)
  // Also check auth events if available
  for (const user of users) {
    try {
      const detail = await cognito.send(
        new AdminGetUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: user.username,
        })
      );
      // UserLastModifiedDate from AdminGetUser might differ
      user.lastModifiedAt = detail.UserLastModifiedDate?.toISOString() || user.lastModifiedAt;

      // Check groups
      const groups = await cognito.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: user.username,
        })
      );
      user.groups = (groups.Groups || []).map((g) => g.GroupName);

      // Read last login from DynamoDB (written by PostAuthentication trigger)
      const sub = (detail.UserAttributes || []).find((a) => a.Name === "sub")?.Value;
      if (sub) {
        const loginRecord = await ddb.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${sub}`, SK: "LAST_LOGIN" },
            ProjectionExpression: "lastLoginAt",
          })
        );
        user.lastLoginAt = loginRecord.Item?.lastLoginAt || null;
      }
    } catch {
      // Ignore — we already have basic data
    }
  }

  return response(200, { users, count: users.length });
}

async function deleteTenantUser(tenantId, userId) {
  try {
    // Verify user belongs to tenant
    const user = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
      })
    );

    const tenantAttr = (user.UserAttributes || []).find(
      (a) => a.Name === "custom:tenantId"
    );
    if (tenantAttr?.Value !== tenantId) {
      return response(403, {
        error: "User does not belong to this tenant",
      });
    }

    await cognito.send(
      new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
      })
    );

    return response(200, { message: `User '${userId}' deleted` });
  } catch (err) {
    if (err.name === "UserNotFoundException") {
      return response(404, { error: `User '${userId}' not found` });
    }
    throw err;
  }
}

// ── Main Handler ─────────────────────────────────────────────────

export async function handler(event) {
  // Superadmin check
  if (!isSuperadmin(event)) {
    return response(403, { error: "Forbidden — superadmin role required" });
  }

  const method = event.httpMethod;
  const tenantId = event.pathParameters?.tenantId
    ? decodeURIComponent(event.pathParameters.tenantId)
    : null;
  const userId = event.pathParameters?.userId
    ? decodeURIComponent(event.pathParameters.userId)
    : null;

  // Determine which sub-resource
  const path = event.resource || "";
  const isUserRoute = path.includes("/users");

  console.log(
    `[Tenants] ${method} tenant=${tenantId || "(list)"} userId=${userId || ""} route=${path}`
  );

  try {
    if (method === "OPTIONS") {
      return response(200, {});
    }

    // /tenants/{tenantId}/users routes
    if (isUserRoute && tenantId) {
      switch (method) {
        case "GET":
          return await listTenantUsers(tenantId);
        case "POST":
          return await createTenantUser(
            tenantId,
            JSON.parse(event.body || "{}")
          );
        case "DELETE":
          if (!userId) return response(400, { error: "userId required" });
          return await deleteTenantUser(tenantId, userId);
        default:
          return response(405, { error: `Method ${method} not allowed` });
      }
    }

    // /tenants routes
    switch (method) {
      case "GET":
        return tenantId ? await getTenant(tenantId) : await listTenants();
      case "POST":
        return await createTenant(JSON.parse(event.body || "{}"));
      case "PUT":
        if (!tenantId) return response(400, { error: "tenantId required" });
        return await updateTenant(
          tenantId,
          JSON.parse(event.body || "{}")
        );
      case "DELETE":
        if (!tenantId) return response(400, { error: "tenantId required" });
        return await deleteTenant(tenantId);
      default:
        return response(405, { error: `Method ${method} not allowed` });
    }
  } catch (err) {
    console.error("[Tenants] Error:", err);
    if (err instanceof SyntaxError) {
      return response(400, { error: "Invalid JSON in request body" });
    }
    return response(500, { error: "Internal server error" });
  }
}
