/**
 * auth.js — Cognito authentication (vanilla JS, no SDK dependency)
 *
 * Uses the Cognito InitiateAuth / RespondToAuthChallenge HTTP API
 * directly (USER_PASSWORD_AUTH flow) so we don't need any npm packages.
 *
 * Configuration is loaded from config.js (injected after deploy).
 */

const Auth = (() => {
  // Will be set by config.js or app.js init
  let REGION = "";
  let USER_POOL_ID = "";
  let CLIENT_ID = "";
  let _session = null; // for NEW_PASSWORD_REQUIRED challenge

  function cognitoUrl() {
    return `https://cognito-idp.${REGION}.amazonaws.com/`;
  }

  function configure({ region, userPoolId, clientId }) {
    REGION = region;
    USER_POOL_ID = userPoolId;
    CLIENT_ID = clientId;
  }

  async function cognitoRequest(action, payload) {
    const res = await fetch(cognitoUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message || data.__type || "Cognito error");
      err.code = data.__type;
      throw err;
    }
    return data;
  }

  /**
   * Sign in. Returns { tokens } or { challenge: "NEW_PASSWORD_REQUIRED" }
   * Tries USER_PASSWORD_AUTH first, then falls back to CUSTOM_AUTH
   * (service password) if normal auth fails.
   */
  async function signIn(email, password) {
    // 1. Try normal password auth
    try {
      const data = await cognitoRequest("InitiateAuth", {
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: CLIENT_ID,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      });

      if (data.ChallengeName === "NEW_PASSWORD_REQUIRED") {
        // Before showing change-password UI, try service password via CUSTOM_AUTH
        try {
          return await signInCustomAuth(email, password);
        } catch {
          // Service password didn't work either — show change password form
          _session = data.Session;
          return { challenge: "NEW_PASSWORD_REQUIRED" };
        }
      }

      const tokens = data.AuthenticationResult;
      saveTokens(tokens);
      return { tokens };
    } catch (normalErr) {
      // 2. If normal auth fails, try CUSTOM_AUTH (service password)
      try {
        return await signInCustomAuth(email, password);
      } catch {
        // If custom auth also fails, throw the original error
        throw normalErr;
      }
    }
  }

  /**
   * CUSTOM_AUTH flow for service password
   */
  async function signInCustomAuth(email, password) {
    // Step 1: Initiate custom auth
    const initData = await cognitoRequest("InitiateAuth", {
      AuthFlow: "CUSTOM_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
      },
    });

    if (initData.ChallengeName !== "CUSTOM_CHALLENGE") {
      throw new Error("Unexpected challenge: " + initData.ChallengeName);
    }

    // Step 2: Respond with the service password
    const respondData = await cognitoRequest("RespondToAuthChallenge", {
      ChallengeName: "CUSTOM_CHALLENGE",
      ClientId: CLIENT_ID,
      Session: initData.Session,
      ChallengeResponses: {
        USERNAME: email,
        ANSWER: password,
      },
    });

    const tokens = respondData.AuthenticationResult;
    saveTokens(tokens);
    return { tokens };
  }

  /**
   * Complete NEW_PASSWORD_REQUIRED challenge
   */
  async function completeNewPassword(email, newPassword) {
    const data = await cognitoRequest("RespondToAuthChallenge", {
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      ClientId: CLIENT_ID,
      Session: _session,
      ChallengeResponses: {
        USERNAME: email,
        NEW_PASSWORD: newPassword,
      },
    });
    _session = null;
    const tokens = data.AuthenticationResult;
    saveTokens(tokens);
    return { tokens };
  }

  /**
   * Refresh tokens using the stored refresh token
   */
  async function refreshTokens() {
    const refreshToken = localStorage.getItem("battery_refresh_token");
    if (!refreshToken) throw new Error("No refresh token");

    const data = await cognitoRequest("InitiateAuth", {
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    });
    const tokens = data.AuthenticationResult;
    saveTokens(tokens);
    return tokens;
  }

  function saveTokens(tokens) {
    localStorage.setItem("battery_id_token", tokens.IdToken);
    localStorage.setItem("battery_access_token", tokens.AccessToken);
    if (tokens.RefreshToken) {
      localStorage.setItem("battery_refresh_token", tokens.RefreshToken);
    }
    // Decode ID token to get email
    const payload = JSON.parse(atob(tokens.IdToken.split(".")[1]));
    localStorage.setItem("battery_user_email", payload.email || payload.sub);
    // Store expiry (current time + ExpiresIn seconds)
    const expiry = Date.now() + (tokens.ExpiresIn || 3600) * 1000;
    localStorage.setItem("battery_token_expiry", String(expiry));
  }

  function getIdToken() {
    return localStorage.getItem("battery_id_token");
  }

  function getAccessToken() {
    return localStorage.getItem("battery_access_token");
  }

  function getUserEmail() {
    return localStorage.getItem("battery_user_email");
  }

  function isLoggedIn() {
    const token = getIdToken();
    const expiry = Number(localStorage.getItem("battery_token_expiry") || 0);
    return !!token && Date.now() < expiry;
  }

  /**
   * Ensure we have a valid token; refresh if expired
   */
  async function ensureValidToken() {
    if (isLoggedIn()) return getIdToken();
    try {
      await refreshTokens();
      return getIdToken();
    } catch {
      signOut();
      throw new Error("Session expired");
    }
  }

  function signOut() {
    localStorage.removeItem("battery_id_token");
    localStorage.removeItem("battery_access_token");
    localStorage.removeItem("battery_refresh_token");
    localStorage.removeItem("battery_user_email");
    localStorage.removeItem("battery_token_expiry");
  }

  /**
   * Decode current ID token claims (groups, tenantId, email, etc.)
   */
  function getClaims() {
    const token = getIdToken();
    if (!token) return {};
    try {
      return JSON.parse(atob(token.split(".")[1]));
    } catch {
      return {};
    }
  }

  return {
    configure,
    signIn,
    completeNewPassword,
    refreshTokens,
    ensureValidToken,
    getIdToken,
    getAccessToken,
    getUserEmail,
    getClaims,
    isLoggedIn,
    signOut,
  };
})();
