'use strict';

/**
 * Cognito User Pool Lambda triggers
 */

const CognitoIdentityServiceProvider = require('aws-sdk/clients/cognitoidentityserviceprovider');
const cognitoISP = new CognitoIdentityServiceProvider({
  region: process.env.AWSREGION,
  apiVersion: '2016-04-18'
});

const SES = require('aws-sdk/clients/ses');
const ses = new SES({
  region: process.env.AWSREGION,
  apiVersion: '2010-12-01'
});

const randToken = require('rand-token');

const data = require('data-api-client')({
  secretArn: process.env.AWS_SECRET_STORE_ARN,
  resourceArn: process.env.DB_CLUSTER_ARN,
  database: process.env.DB_NAME
});

/**
 * Send a verification email to the specified user
 *
 * @param {string} id user id to send a verification email
 * @param {string} email user email to verify
 * @param {boolean} isRecruiter indicates if the email owner is recruiter or not
 */
async function sendEmail(id, email, isRecruiter) {
  console.log(`id: ${id}`, `email: ${email}`, `isRecruiter: ${isRecruiter}`);

  // 1. Generate random confirmation code
  let token = randToken.generate(128);

  // 2. Save confirm code in DB table
  return data
    .query(`call usp_save_token(:userId, :token)`, {
      userId: id,
      token: token
    })
    .promise()
    .then(() => {
      const endpoint = process.env.API_ENDPOINT;
      const VERIFY_URL = `${endpoint}/email/verify`;

      // 3. Send an email with verification link to the user
      let verificationLink = `${VERIFY_URL}?id=${id}&is_recruiter=${isRecruiter}&token=${token}`;
      console.log(verificationLink);

      let params = {
        Destination: {
          ToAddresses: [email]
        },
        Message: {
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: `Please click the link below to verify your email address. <a class="ulink" href="${verificationLink}" target="_blank">Verify Email</a>`
            }
          },
          Subject: {
            Charset: 'UTF-8',
            Data: 'Verify Your Email'
          }
        },
        Source: 'support@allmysons.com'
      };
      return ses.sendEmail(params).promise();
    })
    .then(() => {
      console.log('Successfully, sent a verification email');
    })
    .catch(error => {
      console.error('Email sending error:', JSON.stringify(error));
    });
}

/**
 * Pre-Signup trigger
 *
 * Auto confirm new user
 * Auto verify user email, in case of federated or admin user
 */
module.exports.preSignup = (event, context, callback) => {
  console.log(JSON.stringify(event));

  // Auto confirm user
  event.response.autoConfirmUser = true;
  console.log('Auto confirmed user');

  event.response.autoVerifyEmail = true;
  console.log('Auto verified email');

  // let userAttributes = event.request.userAttributes;

  // Auto verify email if new user is admin
  // const isAdmin = event.callerContext.clientId === process.env[`CLIENT_ID_ADMIN`];
  // if (userAttributes.hasOwnProperty('email') && isAdmin) {
  // event.response.autoVerifyEmail = true;
  // console.log("Auto verified admin's email");
  // }

  // Auto verify email if new user is federated user
  // if (event.userName.includes('Facebook') || event.userName.includes('Google')) {
  //   event.response.autoVerifyEmail = true;
  // }

  // Auto verify phone number
  if (event.request.userAttributes.hasOwnProperty('phone_number')) {
    event.response.autoVerifyPhone = true;
    console.log('Auto verifed phone_number');
  }

  callback(null, event);
};

/**
 * Post-Confrimation trigger: This will be triggered after cognito user has been confirmed
 *
 * Here we will do following things:
 * 1. Decide user type
 * 2. Check if the user is CC type
 * 3. Migrate confirmed user from User Pool to DDB
 * 4. Update its invitation record if the user is CC type
 * 5. Add the user to corresponding User Pool group
 * 6. Send verification email to the user
 */
module.exports.postConfirmation = async event => {
  console.log(JSON.stringify(event));

  const userAttributes = event.request.userAttributes;

  // Skip the process in case of admin
  const isAdmin = event.callerContext.clientId === process.env[`CLIENT_ID_ADMIN`];
  if (isAdmin) {
    return event;
  }

  // 1. Decide if the user is recrutier or candidate
  const isRecruiter = event.callerContext.clientId === process.env[`CLIENT_ID_REC`];

  // 2. Try to get invitation id of this user
  var invitationId;

  if (!isRecruiter) {
    // Try to get invitation id
    try {
      let invitations = await data.query(`call usp_get_invitation(:email)`, { email: userAttributes.email });
      invitations = invitations.records;

      let isCC = invitations && invitations.length > 0;

      if (isCC) {
        invitationId = invitations[0].ID;
      }
    } catch (error) {
      console.error(error);
    }
  }

  // 3. Migrate the user from User Pool to DB
  var params;

  var promises = [];

  let vars = {
    username: event.userName,
    email: userAttributes.email,
    firstName: userAttributes['given_name'],
    lastName: userAttributes['family_name'],
    userType: isRecruiter ? 'Recruiter' : 'Candidate',
    type: !isRecruiter && invitationId ? 'CC' : 'HGC',
    phone: userAttributes['phone_number'],
    zip: userAttributes['custom:zip']
  };

  let promise1 = data
    .query(`call usp_insert_users(:username, :email,  :firstName, :lastName, :userType, :type, :phone, :zip)`, vars)
    .then(() => {
      console.log('Successfully, migrated the user into DB!');
    })
    .catch(error => {
      console.error('Sorry, Could not migrate user in DB');
      console.error(JSON.stringify(error.message));
    });
  promises.push(promise1);

  // 4. Update invitation record for this user
  if (invitationId && !isRecruiter) {
    let promise2 = data
      .query(`call usp_update_invitation(:id, :userId)`, {
        id: invitationId,
        userId: userAttributes['sub']
      })
      .then(() => {
        console.log('Successfully, updated invitation record');
      })
      .catch(error => {
        console.error('Sorry, Could not update invitation record!');
        console.error(JSON.stringify(error));
      });
    promises.push(promise2);
  }

  // 5. Add user to appropriate group of Cognito User Pool
  let promise3 = cognitoISP
    .adminAddUserToGroup({
      GroupName: isRecruiter ? 'Recruiter' : 'Candidate',
      UserPoolId: process.env[`USER_POOL_ID`],
      Username: event.userName
    })
    .promise()
    .then(() => {
      console.log('Successfully, added the user to group!');
    })
    .catch(console.error);
  promises.push(promise3);

  await Promise.all(promises);

  // 6. Send verification email to the user for non-federated users
  const isFederated = event.userName.includes('Facebook') || event.userName.includes('Google');

  // Skip for federated users
  if (!isFederated) {
    await sendEmail(userAttributes.sub, userAttributes.email, isRecruiter);
  }

  return event;
};
