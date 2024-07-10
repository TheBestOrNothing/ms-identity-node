/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

var express = require('express');
var router = express.Router();

router.get('/tmp', function (req, res, next) {
    res.render('index', {
        title: 'MSAL Node & Express Web App',
        isAuthenticated: req.session.isAuthenticated,
        username: req.session.account?.username,
    });
});

router.get('/', function (req, res, next) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

router.get('/me', function (req, res, next) {

        const responseObject = {
        "username": "gitcoins",
        "name": "Gitcoins",
        "email": "gitcoins@outlook.com"
        };

    res.json(responseObject); // Send JSON response
});

module.exports = router;
