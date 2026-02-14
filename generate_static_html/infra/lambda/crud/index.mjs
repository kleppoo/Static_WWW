/**
 * Lambda CRUD handler for battery data in DynamoDB.
 *
 * Multi-tenant with role isolation:
 *   - superadmin: can access any tenant's data (sends X-Tenant-Id header)
 *   - tenant user: can only access own tenant (from JWT custom:tenantId claim)
 *
 * Routes (via API Gateway):
 *   POST   /batteries           → create battery
 *   GET    /batteries           → list batteries
 *   GET    /batteries/{code}    → get battery
 *   PUT    /batteries/{code}    → update battery
 *   DELETE /batteries/{code}    → delete battery
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME;

// ── JWT / Auth helpers ───────────────────────────────────────────

/**
 * Decode JWT payload (Cognito ID token) from the Authorization header.
 * We don't need to verify — API Gateway Cognito authorizer already did.
 */
function decodeJwt(event) {
  const authHeader =
    event.headers?.Authorization || event.headers?.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return {};
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString()
    );
    return payload;
  } catch {
    return {};
  }
}

/**
 * Get user role & tenant from JWT claims.
 * Returns { role: "superadmin"|"tenant", tenantId: string, email: string }
 */
function getUserContext(event) {
  const jwt = decodeJwt(event);
  const groups = jwt["cognito:groups"] || [];
  const isSuperadmin = groups.includes("superadmin");
  const tenantIdFromToken = jwt["custom:tenantId"] || null;
  const email = jwt.email || jwt.sub || "unknown";

  // superadmin can override tenant via header
  let tenantId;
  if (isSuperadmin) {
    tenantId =
      event.headers?.["x-tenant-id"] ||
      event.headers?.["X-Tenant-Id"] ||
      tenantIdFromToken ||
      "default";
  } else {
    // Tenant user MUST use their own tenant — ignore header
    tenantId = tenantIdFromToken;
    if (!tenantId) {
      return { role: "none", tenantId: null, email, error: "No tenantId assigned" };
    }
  }

  return {
    role: isSuperadmin ? "superadmin" : "tenant",
    tenantId,
    email,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function pk(tenantId) {
  return `TENANT#${tenantId}`;
}
function sk(code) {
  return `BATTERY#${code}`;
}

function response(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Api-Key,X-Tenant-Id",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function extractCode(event) {
  const raw = event.pathParameters?.code || null;
  if (!raw) return null;
  return decodeURIComponent(raw);
}

// ── CRUD Operations ──────────────────────────────────────────────

async function createBattery(tenantId, body) {
  if (!body || !body.page?.code) {
    return response(400, { error: "Missing required field: page.code" });
  }

  const code = body.page.code;
  const now = new Date().toISOString();

  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk(tenantId), SK: sk(code) },
      ProjectionExpression: "PK",
    })
  );

  if (existing.Item) {
    return response(409, {
      error: `Battery '${code}' already exists. Use PUT to update.`,
    });
  }

  const item = {
    PK: pk(tenantId),
    SK: sk(code),
    code,
    tenantId,
    data: body,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  return response(201, {
    message: "Battery created",
    battery: { code, status: "draft", createdAt: now },
  });
}

async function getBattery(tenantId, code) {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk(tenantId), SK: sk(code) },
    })
  );

  if (!result.Item) {
    return response(404, { error: `Battery '${code}' not found` });
  }

  const { PK, SK, ...battery } = result.Item;
  return response(200, battery);
}

async function listBatteries(tenantId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": pk(tenantId),
        ":prefix": "BATTERY#",
      },
    })
  );

  const items = (result.Items || []).map(({ PK, SK, ...rest }) => rest);

  return response(200, {
    items,
    count: result.Count || 0,
  });
}

async function updateBattery(tenantId, code, body) {
  if (!body) {
    return response(400, { error: "Request body is required" });
  }

  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk(tenantId), SK: sk(code) },
    })
  );

  if (!existing.Item) {
    return response(404, { error: `Battery '${code}' not found` });
  }

  const now = new Date().toISOString();
  if (body.page) body.page.code = code;

  const item = {
    PK: pk(tenantId),
    SK: sk(code),
    code,
    tenantId,
    data: body,
    status: "draft",
    createdAt: existing.Item.createdAt || now,
    updatedAt: now,
    publishedAt: existing.Item.publishedAt || null,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  return response(200, {
    message: "Battery updated",
    battery: { code, status: "draft", updatedAt: now },
  });
}

async function deleteBattery(tenantId, code) {
  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk(tenantId), SK: sk(code) },
      ProjectionExpression: "PK",
    })
  );

  if (!existing.Item) {
    return response(404, { error: `Battery '${code}' not found` });
  }

  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk(tenantId), SK: sk(code) },
    })
  );

  return response(200, { message: `Battery '${code}' deleted` });
}

// ── Main Handler ─────────────────────────────────────────────────

export async function handler(event) {
  const method = event.httpMethod;
  const code = extractCode(event);
  const ctx = getUserContext(event);

  console.log(
    `[CRUD] ${method} code=${code || "(list)"} tenant=${ctx.tenantId} role=${ctx.role} user=${ctx.email}`
  );

  if (ctx.error) {
    return response(403, { error: ctx.error });
  }

  try {
    if (method === "OPTIONS") {
      return response(200, {});
    }

    switch (method) {
      case "POST":
        return await createBattery(ctx.tenantId, JSON.parse(event.body || "{}"));
      case "GET":
        return code
          ? await getBattery(ctx.tenantId, code)
          : await listBatteries(ctx.tenantId);
      case "PUT":
        if (!code)
          return response(400, { error: "Battery code required in URL" });
        return await updateBattery(
          ctx.tenantId,
          code,
          JSON.parse(event.body || "{}")
        );
      case "DELETE":
        if (!code)
          return response(400, { error: "Battery code required in URL" });
        return await deleteBattery(ctx.tenantId, code);
      default:
        return response(405, { error: `Method ${method} not allowed` });
    }
  } catch (err) {
    console.error("[CRUD] Error:", err);
    if (err instanceof SyntaxError) {
      return response(400, { error: "Invalid JSON in request body" });
    }
    return response(500, { error: "Internal server error" });
  }
}
