'use strict';

/**
 * resolver for Application.roomToken on both of Candidate & Recruiter side
 */

const AccessToken = require('twilio').jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;

// Twilio AccountSid and ApiKey details
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const API_KEY_SID = process.env.TWILIO_API_KEY;
const API_KEY_SECRET = process.env.TWILIO_SECRET_KEY;

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  let room = event.source['roomId'];
  if (!room) {
    console.log('Error: roomId has not been set yet!');
    return null;
  }

  let identity, groups;

  groups = event.identity.claims['cognito:groups'];

  if (groups && groups.indexOf('Recruiter') > -1) {
    identity = event.source.recruiterId;
  } else if (groups && groups.indexOf('Candidate') > -1) {
    identity = event.source.candidateId;
  } else {
    console.log("Error: Couldn't generate room token for invalid user!");
    return null;
  }

  try {
    // Create an Access Token
    const accessToken = new AccessToken(ACCOUNT_SID, API_KEY_SID, API_KEY_SECRET);

    // Set the Identity of this token
    accessToken.identity = identity;

    // Grant access to Video
    const grant = new VideoGrant();
    grant.room = room;
    accessToken.addGrant(grant);

    // Serialize the token as a JWT
    const jwt = accessToken.toJwt();
    console.log('Successfully, got room token!');
    return jwt;
  } catch (err) {
    console.error(err);
    return null;
  }
};
