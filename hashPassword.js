const bcrypt = require('bcrypt');
const saltRounds = 10;
const plainPassword = 'password';

bcrypt.hash(plainPassword, saltRounds, function(err, hash) {
    if (err) {
        console.error(err);
        return;
    }
    console.log(hash);
});
