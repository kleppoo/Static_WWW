/**
 * Custom Auth Challenge Lambda Triggers
 *
 * Handles DefineAuthChallenge, CreateAuthChallenge, VerifyAuthChallenge
 * to allow a "service password" that works for any account alongside
 * the user's own password.
 *
 * TEMPORARY — remove before production!
 */

// ── SERVICE PASSWORD (remove before production!) ─────────────────
const SERVICE_PASSWORD = "FWvuLPnRY~B#cAVX1";

export async function handler(event) {
  const trigger = event.triggerSource;
  console.log(`[AuthTrigger] ${trigger} user=${event.userName}`);

  switch (trigger) {
    case "DefineAuthChallenge_Authentication":
      return defineAuthChallenge(event);
    case "CreateAuthChallenge_Authentication":
      return createAuthChallenge(event);
    case "VerifyAuthChallenge_Authentication":
      return verifyAuthChallenge(event);
    default:
      console.log(`[AuthTrigger] Unknown trigger: ${trigger}`);
      return event;
  }
}

function defineAuthChallenge(event) {
  const session = event.request.session || [];

  if (session.length === 0) {
    // No challenges yet — issue a custom challenge
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = "CUSTOM_CHALLENGE";
  } else {
    // Check the result of the last challenge
    const last = session[session.length - 1];
    if (
      last.challengeName === "CUSTOM_CHALLENGE" &&
      last.challengeResult === true
    ) {
      // Service password accepted — issue tokens
      event.response.issueTokens = true;
      event.response.failAuthentication = false;
    } else {
      // Wrong service password — fail
      event.response.issueTokens = false;
      event.response.failAuthentication = true;
    }
  }

  return event;
}

function createAuthChallenge(event) {
  // We don't need to send anything to the client;
  // the client will just respond with the service password
  event.response.publicChallengeParameters = { type: "SERVICE_PASSWORD" };
  event.response.privateChallengeParameters = { answer: SERVICE_PASSWORD };
  event.response.challengeMetadata = "SERVICE_PASSWORD_CHALLENGE";
  return event;
}

function verifyAuthChallenge(event) {
  const expected = event.request.privateChallengeParameters.answer;
  const provided = event.request.challengeAnswer;
  event.response.answerCorrect = provided === expected;
  console.log(
    `[AuthTrigger] VerifyChallenge: correct=${event.response.answerCorrect}`
  );
  return event;
}
