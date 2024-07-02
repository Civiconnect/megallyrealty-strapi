module.exports = {
    ingestDDFListings: {
        task: async ({ strapi }) => {

            const https = require('https');
            const fs = require('fs');

            const newTimestamp = new Date().toISOString();

            console.log("Ingest MLS Listings Test Run: " + newTimestamp);

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
            }
            
            const getPropertyStatus = (property) => {
                const active = property.StandardStatus === 'Active'; // Can be 'Active', 'Tombstone' (sold), or 'Historical' (?)

                if (property.TotalActualRent || property.LeaseAmount)
                    return active ? "For Lease" : "Leased";
                else if (property.ListPrice)
                    return active ? "For Sale" : "Sold";
                else
                    return active ? "For Sale" : "Sold";
            }

            const getPropertyPrice = (property) => {
                return property.TotalActualRent ? property.TotalActualRent : 
                    property.LeaseAmount ? property.LeaseAmount * getPropertySqFt(property) : 
                    property.ListPrice ? property.ListPrice : 0; 
            }

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
            }

            const uploadMedia = async (entry, property) => {
                const mediaKeysInStrapi = entry ? entry.PhotosAndVideos.map(upload => upload.caption) : [];
                const mlsMediaToUpload = !entry ? property.Media : 
                    property.Media.filter(media => !mediaKeysInStrapi.some(key => media.MediaKey === key));

                fs.mkdir('./tmp', {recursive: true}, (err) => {
                    if (err) throw err;
                });
                
                const mediaToUpload = await Promise.all(mlsMediaToUpload.map(async media => {
                    const filePath = `./tmp/${media.MediaURL.substring(media.MediaURL.lastIndexOf('/') + 1)}`;
                    const stream = fs.createWriteStream(filePath);
                    
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
                    });

                    const fileSize = fs.statSync(filePath).size;

                    const file = {
                        path: filePath,
                        name: media.MediaURL.substring(media.MediaURL.lastIndexOf('/') + 1),
                        type: mimeType,
                        size: fileSize,
                    };

                    return {
                        data: {
                            fileInfo: {
                                name: media.MediaURL.substring(media.MediaURL.lastIndexOf('/') + 1),
                                caption: media.MediaKey,
                            },
                        },
                        files: file,
                    };
                }));

                const mediaKeysInMLS = property.Media.map(media => media.MediaKey);
                const strapiMediaToDelete = !entry ? [] :
                    entry.PhotosAndVideos.filter(upload => !mediaKeysInMLS.some(key => upload.caption === key));

                const [uploadRes, deleteRes] = await Promise.all([
                    Promise.all(mediaToUpload.map(media => strapi.plugins.upload.services.upload.upload(media))),
                    Promise.all(strapiMediaToDelete.map(upload => strapi.plugins.upload.services.upload.remove({id: upload.id})))
                ]);

                const newPhotosAndVideosIds = entry ? [...entry.PhotosAndVideos.map(media => Object({id: media.id})), ...uploadRes.map(upload => Object({id: upload[0].id}))]
                    : uploadRes.map(upload => Object({id: upload[0].id}));

                const featuredPhotoKey = property.Media.find(media => media.PreferredPhotoYN).MediaKey;
                const featuredPhotoId = (entry ? Object({id: entry.PhotosAndVideos.find(entry => entry.caption === featuredPhotoKey).id}) : null)
                    || Object({id: uploadRes.find(upload => upload[0].caption === featuredPhotoKey)[0].id}) || null;

                fs.rmSync('./tmp', {recursive: true, force: true}, (err) => {
                    if (err) throw err;
                }); 

                return {
                    PhotosAndVideos: newPhotosAndVideosIds,
                    FeaturedPhoto: featuredPhotoId
                };            
            }

            // Function to convert a DDF Property listing to our Strapi object
            const ddfListingToStrapiEntry = async (entry, property) => {
                const {PhotosAndVideos, FeaturedPhoto} = await uploadMedia(entry, property);

                return {
                    MLS:  property.ListingKey ? property.ListingKey : 0,
                    MLSLink: property.ListingURL ? property.ListingURL : "",
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
                    latitude: property.Latitude, // TO BE DEPRECATED
                    longitude: property.Longitude, // TO BE DEPRECATED
                    Address: getPropertyAddressString(property), // TO BE DEPRECATED
                    City: property.City, // TO BE DEPRECATED
                    Province: property.StateOrProvince, // TO BE DEPRECATED
                    FeaturedPhoto: FeaturedPhoto,
                    PhotosAndVideos: PhotosAndVideos,
                };
            };

            // Fetch config 

            const config = await strapi.db.query('api::mls-config.mls-config').findOne({
                select: ['timestamp', 'members'],
            });

            const timeOfLastFetch = config.timestamp;
            const memberKeys = config.members.map(member => member.key);

            // Update timestamp
            await strapi.entityService.update('api::mls-config.mls-config', 1, {
                data: {
                    timestamp: newTimestamp
                }
            });

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
            .catch(err => {console.log(err.message); throw new Error(err);});

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
            .catch(err => {console.log(err.message); throw new Error(err);});

            // Designate and create entries to be updated vs. created based on existing ListingKey

            const propertyKeys = properties.map(property => property.ListingKey).filter(Boolean);

            const propertiesToUpdateOld = await strapi.entityService.findMany('api::listing.listing', {
                filters: { MLS: propertyKeys },
                populate: { PhotosAndVideos: true }
            });
            const propertiesToUpdateOldMLSKeys = propertiesToUpdateOld.map(entry => entry.MLS);

            const [propertiesToUpdateNew, propertiesToCreate] = await Promise.all([
                Promise.all(
                    propertiesToUpdateOld.map(async entry => Object({
                        id: entry.id,
                        data: await ddfListingToStrapiEntry(entry, properties.filter(property => property.ListingKey === entry.MLS)[0])
                    }))
                ),
                Promise.all(
                    properties.filter(property => 
                        !propertiesToUpdateOldMLSKeys.includes(property.ListingKey)).map(property => 
                            ddfListingToStrapiEntry(null, property)
                    )
                )
            ]);

            console.log(`Creating: ${propertiesToCreate.length} | Updating: ${propertiesToUpdateNew.length} | Total: ${propertiesToCreate.length + propertiesToUpdateNew.length}`);

            // Update and create listings 
            Promise.all([
                Promise.all(propertiesToUpdateNew.map(entry => strapi.entityService.update('api::listing.listing', entry.id, { data: entry.data }))),
                Promise.all(propertiesToCreate.map(entry => strapi.entityService.create('api::listing.listing', { data: entry })))
            ])
            .then(() => console.log("SUCCESS"))
            .catch(err => {
                console.log(err);
                throw new Error(err);
            });
        },
        options: {
            rule: "* * * * *", // Per minute
        }
    }
}