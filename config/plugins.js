module.exports = ({ env }) => ({
	upload: {
		config: {
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
});
