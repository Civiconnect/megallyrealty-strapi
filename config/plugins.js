module.exports = ({ env }) => ({
	upload: {
		config: {
			sizeLimit: 2000 * 1024 * 1024, // 2GB
			provider: "aws-s3",
			providerOptions: {
				s3Options: {
					accessKeyId: env("S3_ACCESS_KEY_ID"),
					secretAccessKey: env("S3_SECRET_ACCESS_KEY"),
					region: env("S3_REGION"),
					params: {
						Bucket: env("S3_BUCKET_NAME"),
					},
				},
			},
			actionOptions: {
				upload: { ACL: "public-read" },
				uploadStream: { ACL: "public-read" },
				delete: {},
			},
		},
	},
	email: {
		config: {
			provider: "nodemailer",
			providerOptions: {
				host: env("SMTP_HOST", "smtp.example.com"),
				port: env("SMTP_PORT", 587),
				auth: {
					user: env("SMTP_USERNAME"),
					pass: env("SMTP_PASSWORD"),
				},
				// ... any custom nodemailer options
			},
		},
	},
	"location-field": {
		enabled: true,
		config: {
			fields: ["photo", "rating"], // optional
			// You need to enable "Autocomplete API" and "Places API" in your Google Cloud Console
			googleMapsApiKey: env("GOOGLE_MAPS_API_KEY"),
			// See https://developers.google.com/maps/documentation/javascript/reference/places-autocomplete-service#AutocompletionRequest
			autocompletionRequestOptions: {},
		},
	},
	"fuzzy-search": {
		enabled: true,
		config: {
			contentTypes: [
				{
					uid: "api::listing.listing",
					modelName: "listing",
					transliterate: true,
					fuzzysortOptions: {
						characterLimit: 300,
						threshold: -600,
						limit: 10,
						keys: [
							{
								name: "Address",
								weight: 100,
							},
							{
								name: "City",
								weight: 150,
							},
							{
								name: "Province",
								weight: 50,
							},
							{
								name: "Description",
								weight: 100,
							},
							{
								name: "MLS",
								weight: 300,
							},
						],
					},
				},
			],
		},
	},
});
