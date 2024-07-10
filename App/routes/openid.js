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

router.get('/userinfo', function (req, res, next) {
    const jsonObject = {
        amr: '["pwd","mfa"]',
        family_name: 'Gump',
        given_name: 'Forrest',
        ipaddr: '34.92.204.228',
        name: 'Forrest Gump',
        oid: '90f7596b-88b6-4768-8204-8c476a73fe25',
        rh: '0.AbcAqYXm1SM-2UKe-hXMXBzn2xNWhOMxA8BJnxH7amNCQtL8APU.',
        sub: 'KGceLH-HoENIN5H4jVwwaLI2rtpH-S2CTnJCHA0y0ak',
        tid: 'd5e685a9-3e23-42d9-9efa-15cc5c1ce7db',
        unique_name: 'ForrestGump@Gitcoins.onmicrosoft.com',
        upn: 'ForrestGump@Gitcoins.onmicrosoft.com',
        uti: 'YCuQilrDeEeCWYCghqobAA',
        ver: '1.0'
    };

    res.json(jsonObject);
});

module.exports = router;
