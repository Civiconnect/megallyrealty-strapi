"use strict";

// const { env } = require("strapi-utils");

// TODO - Setup email provider (nodemailer)

/**
 * contact-form-submission controller
 */

const { createCoreController } = require("@strapi/strapi").factories;

// TODO - replace with email or use .env here

module.exports = createCoreController("api::message.message", ({ strapi }) => ({
	// Wraps core create route
	async create(ctx) {
		const notificationRecipients = await strapi.entityService.findMany(
			"api::notification-recipient.notification-recipient"
		); // TODO - notification recipient collection with 'Email' field should be set up

		// Calling the default core action
		const { data, meta } = await super.create(ctx);

		const requestData = ctx.request.body.data;

		// send email using strapi email plugin
		notificationRecipients.forEach(async (recipient) => {
			await strapi.plugins["email"].services.email.send({
				to: recipient.Email,
				from: process.env.SMTP_USERNAME,
				subject: "You've received a message from your website!",
				html: `<p>Hi,</p>
                  <p>You've received a message from ${requestData.userName}.</p>
                  <p>They are interested in the following service(s): ${requestData.ServicesOfInterest}</p>
                  <p><strong>Message:</strong></p>
                  <p>${requestData.Message}</p>
                  <p>Here is their contact info:</p>
                  <p>Email: ${requestData.userEmail}</p>
                  <p>Phone: ${requestData.phoneNumber}</p>
                 `,
			});
		});

		return { data, meta };
	},
}));
