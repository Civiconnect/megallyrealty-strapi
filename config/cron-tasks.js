const https = require('https');
const fs = require('fs');

const ingestDDFListingsHelper = async (strapi) => {

    const newTimestamp = new Date().toISOString();

    console.log("--------Ingest MLS Listings Run: " + newTimestamp);

    // Conversions to Square Feet since DDF can give one of several units
    const lotSizeUnitConversions = {
        "square feet": 1,
        "square meters": 10.7639,
        "acres": 43560,
        "hectares": 107639,
    };

    const getPropertySqFt = (property) => {
        const area = property.LivingArea ? property.LivingArea : 0;
        const units = property.LivingAreaUnits ? property.LivingAreaUnits : "square feet";

        return area * lotSizeUnitConversions[units];
    };
    
    const getPropertyStatus = (property) => {
        const active = property.StandardStatus === 'Active'; // Can be 'Active', 'Tombstone' (sold), or 'Historical' (?)

        if (property.TotalActualRent || property.LeaseAmount)
            return active ? "For Lease" : "Leased";
        else if (property.ListPrice)
            return active ? "For Sale" : "Sold";
        else
            return active ? "For Sale" : "Sold";
    };

    const getPropertyPrice = (property) => {
        return property.TotalActualRent ? property.TotalActualRent : 
            property.LeaseAmount ? property.LeaseAmount * getPropertySqFt(property) : 
            property.ListPrice ? property.ListPrice : 0; 
    };

    const getPropertyAddressString = (property) => {
        if (property.StreetNumber === null) {
            return `${property.UnparsedAddress}, ${property.City}, ${property.StateOrProvince}, ${property.Country}`;
        }

        const unitNumber = property.UnitNumber ? `${property.UnitNumber} - ` : '';
        const streetNumber = property.StreetNumber ? `${property.StreetNumber} ` : '';
        const streetName = property.StreetName ? `${property.StreetName} ` : '';
        const streetSuffix = property.StreetSuffix ? `${property.StreetSuffix}` : '';
        const streetDirPrefix = property.StreetDirPrefix ? ` ${property.StreetDirPrefix}` : '';
        const streetDirSuffix = property.StreetDirSuffix ? ` ${property.StreetDirSuffix}` : '';
        const city = property.City ? `, ${property.City}` : '';
        const stateProvince = property.StateOrProvince ? `, ${property.StateOrProvince}` : '';
        const country = property.Country ? `, ${property.Country}` : '';

        // Example: 99 - 2900 Dundas Street W, Toronto, Ontario, Canada
        return unitNumber + streetNumber + streetName + streetSuffix + streetDirPrefix + streetDirSuffix + city + stateProvince + country;
    };

    const uploadMedia = async (entry, property) => {
        const mediaKeysInStrapi = entry ? entry.PhotosAndVideos.map(upload => upload.caption) : [];
        const mlsMediaToUpload = !entry ? property.Media : 
            property.Media.filter(media => !mediaKeysInStrapi.some(key => media.MediaKey === key));

        fs.mkdir('./tmp', {recursive: true}, (err) => {
            if (err) {
                console.log("ERROR: Error while creating tmp folder");
                console.log(err);
                throw err;
            }
        });
        
        const mediaToUpload = await Promise.all(mlsMediaToUpload.map(async media => {
            const fileName = media.MediaURL.substring(media.MediaURL.lastIndexOf('/') + 1);
            const filePath = `./tmp/${fileName}`;
            const stream = fs.createWriteStream(filePath);
            
            // Download file locally and get mime type
            const mimeType = await new Promise((resolve, reject) => {
                https.get(media.MediaURL, res => {
                    res.pipe(stream);
                    stream.on('finish', () => {
                        stream.close(() => {
                            resolve(res.headers['content-type']);
                        });
                    });
                }).on('error', (err) => {
                    fs.unlink(filePath, () => reject(err));
                });
            })
            .then(res => res)
            .catch(err => {
                console.log("ERROR: Error while downloading media file");
                console.log(err);
                throw err;
            });

            const fileSize = fs.statSync(filePath).size;

            const file = {
                path: filePath,
                name: fileName,
                type: mimeType,
                size: fileSize,
            };

            return {
                data: {
                    fileInfo: {
                        name: fileName,
                        caption: media.MediaKey,
                    },
                },
                files: file,
            };
        }))
        .then(res => res)
        .catch(err => {
            console.log("ERROR: Error while handling media file");
            console.log(err);
        });

        const mediaKeysInMLS = property.Media.map(media => media.MediaKey);
        const strapiMediaToDelete = !entry ? [] :
            entry.PhotosAndVideos.filter(upload => !mediaKeysInMLS.some(key => upload.caption === key));

        const [uploadRes, deleteRes] = await Promise.all([
            Promise.all(mediaToUpload.map(media => strapi.plugins.upload.services.upload.upload(media))),
            Promise.all(strapiMediaToDelete.map(upload => strapi.plugins.upload.services.upload.remove({id: upload.id})))
        ])
        .then(res => res)
        .catch(err => {
            console.log("ERROR: Error while uploading or deleting media");
            console.log(err);
        });

        const newFeaturedPhotoKey = property.Media.find(media => media.PreferredPhotoYN).MediaKey;
        const newFeaturedPhotoId = Object({id:
            ( 
                (entry?.PhotosAndVideos?.find(entry => entry.caption === newFeaturedPhotoKey)?.id)
                || (uploadRes.find(upload => upload[0].caption === newFeaturedPhotoKey)[0]?.id)
                || null
            )
        });
        
        const remainingPhotosAndVideos = !entry ? [] :
            entry.PhotosAndVideos.filter(media => !strapiMediaToDelete.some(deleteMedia => deleteMedia.id === media.id));

        const newPhotosAndVideosIds = [
            ...(remainingPhotosAndVideos?.map(upload => Object({id: upload.id})) || []),
            ...(uploadRes?.map(upload => Object({id: upload[0].id})) || []),
        ];

        fs.rmSync('./tmp', {recursive: true, force: true}, (err) => {
            if (err) {
                console.log("ERROR: Error while deleting tmp folder");
                console.log(err);
                throw err;
            }
        }); 

        return {
            PhotosAndVideos: newPhotosAndVideosIds,
            FeaturedPhoto: newFeaturedPhotoId
        };            
    }

    // Function to convert a DDF Property listing to our Strapi object
    const ddfListingToStrapiEntry = async (entry, property) => {
        const {PhotosAndVideos, FeaturedPhoto} = await uploadMedia(entry, property)
            .then(res => res)
            .catch(err => {
                console.log("ERROR: Error while uploading media");
                console.log(err);    
            });

        return {
            MLS:  property.ListingId ? property.ListingId : "N/A",
            MLSLink: property.ListingURL ? (!property.ListingURL.startsWith('https://') ? 'https://' : '') + property.ListingURL : "",
            Description: property.PublicRemarks ? property.PublicRemarks : "",
            Availability: getPropertyStatus(property),
            Price: getPropertyPrice(property),
            Bedrooms: property.BedroomsTotal ? property.BedroomsTotal : 0,
            Bathrooms: property.BathroomsTotalInteger ? property.BathroomsTotalInteger : 0,
            SqFt: getPropertySqFt(property),
            FeaturedListing: false,
            location: {
                lat: property.Latitude,
                lng: property.Longitude,
                description: getPropertyAddressString(property),
            },
            FeaturedPhoto: FeaturedPhoto,
            PhotosAndVideos: {set: PhotosAndVideos},
        };
    };

    // Fetch config from Strapi

    const config = await strapi.db.query('api::mls-config.mls-config').findOne({
        select: ['timestamp', 'members'],
    })
    .then(res => res)
    .catch(err => {
        console.log("ERROR: Error while fetching MLS config");
        console.log(err);
        throw err;
    });

    const timeOfLastFetch = config.timestamp;
    const memberKeys = config.members.map(member => member.key);

    // Update timestamp in Strapi
    try {
        await strapi.entityService.update('api::mls-config.mls-config', 1, {
            data: {
                timestamp: newTimestamp
            }
        });
    } catch (err) {
        console.log("ERROR: Could not update timestamp");
        console.log(err);
    }

    // Construct query filter

    const memberFilter = memberKeys.map(key => `ListAgentKey eq '${key}' or CoListAgentKey eq '${key}'`).join(' or ');
    const dateFilter = `OriginalEntryTimestamp ge ${timeOfLastFetch} or ModificationTimestamp ge ${timeOfLastFetch}`;
    const filterString = `$filter=(${memberFilter})${timeOfLastFetch ? ` and (${dateFilter})` : ''}`;

    // MLS API Authentication 

    const authReqBody = new URLSearchParams({
        'client_id': process.env.MLS_API_CLIENT_ID,
        'client_secret': process.env.MLS_API_CLIENT_SECRET,
        'grant_type': "client_credentials",
        'scope': "DDFApi_Read",
    });

    const bearerToken = await fetch("https://identity.crea.ca/connect/token", {
        method: "POST",
        headers: {
            'Content-Type': "application/x-www-form-urlencoded",
        },
        body: authReqBody.toString(),
    })
    .then(res => {
        if (!res.ok)
            throw new Error(res);

        return res.json();
    })
    .then(res => res.access_token)
    .catch(err => {
        console.log("ERROR: Error while fetching authorization token from API");
        console.log(err.message); 
        throw err;
    });

    // MLS API Property request

    const properties = await fetch(`https://ddfapi.realtor.ca/odata/v1/Property?${filterString}`, {
        method: "GET",
        headers: {
            'Authorization': `Bearer ${bearerToken}`
        }
    })
    .then(res => {
        if (!res.ok)
            throw new Error(res);

        return res.json();
    })
    .then(res => res.value)
    .catch(err => {
        console.log("ERROR: Error while fetching Properties from API");
        console.log(err.message); 
        throw err;
    });

    // Designate and create entries to be updated vs. created based on existing ListingKey

    const propertyKeys = properties.map(property => property.ListingId).filter(Boolean);

    const propertiesToUpdateOld = await strapi.entityService.findMany('api::listing.listing', {
        filters: { MLS: propertyKeys },
        populate: { PhotosAndVideos: true }
    })
    .then(res => res)
    .catch(err => {
        console.log("ERROR: Error while fetching properties to update from Strapi");
        console.log(err);
    });

    const propertiesToUpdateOldMLSKeys = propertiesToUpdateOld.map(entry => entry.MLS);

    const [propertiesToUpdateNew, propertiesToCreate] = await Promise.all([
        Promise.all(
            propertiesToUpdateOld.map(async entry => Object({
                id: entry.id,
                data: await ddfListingToStrapiEntry(entry, properties.filter(property => property.ListingId === entry.MLS)[0])
            }))
        ),
        Promise.all(
            properties.filter(property => 
                !propertiesToUpdateOldMLSKeys.includes(property.ListingId)).map(property => 
                    ddfListingToStrapiEntry(null, property)
            )
        )
    ])
    .then(res => res)
    .catch(err => {
        console.log("ERROR: Error while converting MLS entries to Strapi records");
        console.log(err);
        throw err;
    });

    console.log(`Creating: ${propertiesToCreate.length} | Updating: ${propertiesToUpdateNew.length} | Total: ${propertiesToCreate.length + propertiesToUpdateNew.length}`);

    // Update and create listings 
    Promise.all([
        Promise.all(propertiesToUpdateNew.map(entry => strapi.entityService.update('api::listing.listing', entry.id, { data: entry.data }))),
        Promise.all(propertiesToCreate.map(entry => strapi.entityService.create('api::listing.listing', { data: entry })))
    ])
    .then(() => console.log("SUCCESS"))
    .catch(err => {
        console.log("ERROR: Error occurred during update/creation");
        console.log(err);
    });
};

module.exports = {
    // TODO: Wrap in try-catch and cleanup on err?
    ingestDDFListings: {
        task: async ({ strapi }) => {
            try {
                await ingestDDFListingsHelper(strapi);
            } catch (error) {
                console.log("ERROR: Error while running task...");
                console.log(error);

                // Cleanup tmp folder if left behind from premature error
                fs.rmSync('./tmp', {recursive: true, force: true}, (err) => {
                    if (err) {
                        console.log("ERROR: Error while deleting tmp folder (post-error cleanup)");
                        console.log(err);
                    }
                }); 
            }
        },
        options: {
            rule: "0 5 * * *", // Every day at 5:00 AM
        }
    }
}