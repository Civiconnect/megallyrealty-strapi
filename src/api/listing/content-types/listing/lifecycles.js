const copyLocationToDeprecatedAddress = (event) => {
    event.params.data.Address = event.params.data.location.description;
}

module.exports = {
    beforeCreate(event) {
        copyLocationToDeprecatedAddress(event);
    },
    beforeUpdate(event) {
        copyLocationToDeprecatedAddress(event);
    }
}