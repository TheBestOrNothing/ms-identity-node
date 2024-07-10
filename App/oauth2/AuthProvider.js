const msal = require('@azure/msal-node');
const axios = require('axios');
var path = require('path');

const { msalConfig } = require('../authConfig');

class AuthProvider {
    msalConfig;
    cryptoProvider;

    constructor(msalConfig) {
        this.msalConfig = msalConfig
        this.cryptoProvider = new msal.CryptoProvider();
    };

    login(options = {}) {
        return async (req, res, next) => {

            /**
             * MSAL Node library allows you to pass your custom state as state parameter in the Request object.
             * The state parameter can also be used to encode information of the app's state before redirect.
             * You can pass the user's state in the app, such as the page or view they were on, as input to this parameter.
             */
            const state = this.cryptoProvider.base64Encode(
                JSON.stringify({
                    successRedirect: options.successRedirect || '/',
                })
            );

            const authCodeUrlRequestParams = {
                state: state,

                /**
                 * By default, MSAL Node will add OIDC scopes to the auth code url request. For more information, visit:
                 * https://docs.microsoft.com/azure/active-directory/develop/v2-permissions-and-consent#openid-connect-scopes
                 */
                scopes: options.scopes || [],
                redirectUri: options.redirectUri,
            };

            const authCodeRequestParams = {
                state: state,

                /**
                 * By default, MSAL Node will add OIDC scopes to the auth code request. For more information, visit:
                 * https://docs.microsoft.com/azure/active-directory/develop/v2-permissions-and-consent#openid-connect-scopes
                 */
                scopes: options.scopes || [],
                redirectUri: options.redirectUri,
            };

            /**
             * If the current msal configuration does not have cloudDiscoveryMetadata or authorityMetadata, we will 
             * make a request to the relevant endpoints to retrieve the metadata. This allows MSAL to avoid making 
             * metadata discovery calls, thereby improving performance of token acquisition process. For more, see:
             * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/docs/performance.md
             */
            if (!this.msalConfig.auth.cloudDiscoveryMetadata || !this.msalConfig.auth.authorityMetadata) {

                const [cloudDiscoveryMetadata, authorityMetadata] = await Promise.all([
                    this.getCloudDiscoveryMetadata(this.msalConfig.auth.authority),
                    this.getAuthorityMetadata(this.msalConfig.auth.authority)
                ]);

                this.msalConfig.auth.cloudDiscoveryMetadata = JSON.stringify(cloudDiscoveryMetadata);
                this.msalConfig.auth.authorityMetadata = JSON.stringify(authorityMetadata);
            }

            const msalInstance = this.getMsalInstance(this.msalConfig);

            // trigger the first leg of auth code flow
            return this.redirectToAuthCodeUrl(
                authCodeUrlRequestParams,
                authCodeRequestParams,
                msalInstance
            )(req, res, next);
        };
    }

    acquireToken(options = {}) {
        return async (req, res, next) => {
            try {
                const msalInstance = this.getMsalInstance(this.msalConfig);

                /**
                 * If a token cache exists in the session, deserialize it and set it as the 
                 * cache for the new MSAL CCA instance. For more, see: 
                 * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/docs/caching.md
                 */
                if (req.session.tokenCache) {
                    msalInstance.getTokenCache().deserialize(req.session.tokenCache);
                }

                const tokenResponse = await msalInstance.acquireTokenSilent({
                    account: req.session.account,
                    scopes: options.scopes || [],
                });

                /**
                 * On successful token acquisition, write the updated token 
                 * cache back to the session. For more, see: 
                 * https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/docs/caching.md
                 */
                req.session.tokenCache = msalInstance.getTokenCache().serialize();
                req.session.accessToken = tokenResponse.accessToken;
                req.session.idToken = tokenResponse.idToken;
                req.session.account = tokenResponse.account;

                res.redirect(options.successRedirect);
            } catch (error) {
                if (error instanceof msal.InteractionRequiredAuthError) {
                    return this.login({
                        scopes: options.scopes || [],
                        redirectUri: options.redirectUri,
                        successRedirect: options.successRedirect || '/',
                    })(req, res, next);
                }

                next(error);
            }
        };
    }

    handleRedirect(options = {}) {
        return async (req, res, next) => {
            if (!req.body || !req.body.state) {
                return next(new Error('Error: response not found'));
            }

            const authCodeRequest = {
                ...req.session.authCodeRequest,
                code: req.body.code,
                codeVerifier: req.session.pkceCodes.verifier,
            };

            try {
                const msalInstance = this.getMsalInstance(this.msalConfig);

                if (req.session.tokenCache) {
                    msalInstance.getTokenCache().deserialize(req.session.tokenCache);
                }

                const tokenResponse = await msalInstance.acquireTokenByCode(authCodeRequest, req.body);

                req.session.tokenCache = msalInstance.getTokenCache().serialize();
                req.session.idToken = tokenResponse.idToken;
                req.session.account = tokenResponse.account;
                req.session.isAuthenticated = true;

                const state = JSON.parse(this.cryptoProvider.base64Decode(req.body.state));
                res.redirect(state.successRedirect);
            } catch (error) {
                next(error);
            }
        }
    }

    logout(options = {}) {
        return (req, res, next) => {

            /**
             * Construct a logout URI and redirect the user to end the
             * session with Azure AD. For more information, visit:
             * https://docs.microsoft.com/azure/active-directory/develop/v2-protocols-oidc#send-a-sign-out-request
             */
            let logoutUri = `${this.msalConfig.auth.authority}/oauth2/v2.0/`;

            if (options.postLogoutRedirectUri) {
                logoutUri += `logout?post_logout_redirect_uri=${options.postLogoutRedirectUri}`;
            }

            req.session.destroy(() => {
                res.redirect(logoutUri);
            });
        }
    }

    getCode1(options = {}) {
        return (req, res, next) => {

            /**
             * Construct a logout URI and redirect the user to end the
             * session with Azure AD. For more information, visit:
             * https://docs.microsoft.com/azure/active-directory/develop/v2-protocols-oidc#send-a-sign-out-request
             */
            //let logoutUri = `${this.msalConfig.auth.authority}/oauth2/v2.0/`;
            let uri = "http://localhost:3000/_oauth/meta?close&code=0x3a98ac789af4d9a85c77fcd6f50241b78f39906c&state=eyJsb2dpblN0eWxlIjoicG9wdXAiLCJjcmVkZW50aWFsVG9rZW4iOiJMbzNtSGJhNHpnUWc3SXVnclloZ2ZYeWQ1ZFU0NUFnZVJqRVpwei1hajdtIiwiaXNDb3Jkb3ZhIjpmYWxzZX0=";


            res.redirect(uri);
        }
    }

    getCode2(options = {}) {
        return async (req, res, next) => {
            try {
                let uri = "http://34.92.204.228:3000/_oauth/meta?close&code=0x3a98ac789af4d9a85c77fcd6f50241b78f39906c&state=eyJsb2dpblN0eWxlIjoicG9wdXAiLCJjcmVkZW50aWFsVG9rZW4iOiJMbzNtSGJhNHpnUWc3SXVnclloZ2ZYeWQ1ZFU0NUFnZVJqRVpwei1hajdtIiwiaXNDb3Jkb3ZhIjpmYWxzZX0=";

                // Make the GET request to the URI
                const response = await axios.get(uri);

                // Send the result back to the client
                res.setHeader('Content-Type', 'text/html');
                res.json(response.data);
            } catch (error) {
                // Handle any errors that occur during the request
                console.error('Error making GET request:', error);
                res.status(500).send('Error retrieving data');
            }
        }
    }

    getCode(options = {}) {
        return async (req, res, next) => {
            res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
        }
    }

    token(options = {}) {
        return (req, res, next) => {
            const queryParams = req.query;
            const code = queryParams.code;
            console.log(code);
              const tokenResponse = {
    token_type: 'Bearer',
    expires_in: '3599',
    ext_expires_in: '3599',
    expires_on: '1717638666',
    access_token: 'PAQABAQIAAADnfolhJpSnRYB1SVj-Hgd8p8gA3lRIkWiVjFvV3aFNVhXOViIEyPYtOf_z9iWS4jqHDPwyENZJqU4Yn2zXRX9OrBmEuuxgf1wgbeKDDKKiL_CaiHh53A6Xfd7Se1noYBn6CS1ilFtt5qm559rrv7c8Lpz7dkciTZLjhVsnSw__Uz2IoLhpgOmZ4yi4_qiyy0Il8Oi6mpctiVOCMMbpku9PxzkDCa3ZTk39ZxEjkpxsPy5uiEDKpuQJLB25zjV0-YMFbOchvZDu9jfK8h0bhRX1X4ZqlFZlUwEPUEPxib_2VxnEjONGu4rY3S1C3T-oBMkhgK0IFEe-yTRmYFs8kgQa-9qrmMHcoxmiSGYiTgBieAlYTpC6LvPaNajr2pZFLzjnjUcEJcOU5vnJKR3lp1___ZMwcOV55gzuXjamVj72X7X-34nXdGwSHPU3JsoKRI4Zwwm4R7UAhPoAUME2B4ioFDq2wp8mHYEngMAaxlSRpSAA',
    refresh_token: '0.AbcAqYXm1SM-2UKe-hXMXBzn2xNWhOMxA8BJnxH7amNCQtL8APU.AgABAwEAAADnfolhJpSnRYB1SVj-Hgd8AgDs_wUA9P_VDKD03s7tqUzP8vKvKEy1gPDenTmHGVx15xjeWwmI-YYka8UKmlf4-vfMtuiWwNexDXBvS4KPRNAfXTa6Sk-gM7YI3ONH1-lTGUncdLe1Y6F3QZdrx1rDCBssQSFX94ATiY-MxsNFEoJH0l4azSNBV8oWHo84f0p5YqSHVaTMIIme_zDcfWKkKGfM6zURPv2xazKIh9buuUxsTrs4AN3iNx8aAYR1mplDlgBL5hHGaZyifOzmcvIgBOzjuwmyWFCzgLPPxd6GRAh7M3eaN9QbVf0oYQ_5rxw5wQBox9FzhWnfgojklnD2uG6RJGFfZki5O6kMuNZcFuerYliuqO2q2uJG11UDSgfnWK4Wd54I3gH6p9TWcV7DWqOrFDa-hk4RoPPxJChWHcMDur7WlJxG0KOeh4vuU1tyhMikWtNiV_3KPhhyUANoJELGslhd6FqTXJgnxtKa11uAWmYxSW9Xd06St5Q8TIWAnTyfAKV2eMhXti86NWGpSQ7KqKzFA43ZY0l9UXibV8BYSTF4rYwNqLloGkIzq3bj-LHppsg_tX1QfTd8nB4JnLxZlqsn-RLXV1JZmx5O2HHXHDT2yrxwiSkPd5h9cnC4Wk4Wnh7pe5MNrivZjwV3O38oAiZu1m7adyluHBJJxiq8KSMBU8-GmryWFKGbSENJD3VYuh9jHwisoBtDpHbIMBeMADWz1M4b8sB5cA1maQyKMVBFEUcjETK_pH59IHZfJYWMODhkfB3LGH0',
    id_token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6IkwxS2ZLRklfam5YYndXYzIyeFp4dzFzVUhIMCIsImtpZCI6IkwxS2ZLRklfam5YYndXYzIyeFp4dzFzVUhIMCJ9.eyJhdWQiOiJlMzg0NTYxMy0wMzMxLTQ5YzAtOWYxMS1mYjZhNjM0MjQyZDIiLCJpc3MiOiJodHRwczovL3N0cy53aW5kb3dzLm5ldC9kNWU2ODVhOS0zZTIzLTQyZDktOWVmYS0xNWNjNWMxY2U3ZGIvIiwiaWF0IjoxNzE3NjM0NzY2LCJuYmYiOjE3MTc2MzQ3NjYsImV4cCI6MTcxNzYzODY2NiwiYW1yIjpbInB3ZCIsIm1mYSJdLCJmYW1pbHlfbmFtZSI6Ikd1bXAiLCJnaXZlbl9uYW1lIjoiRm9ycmVzdCIsImlwYWRkciI6IjM0LjkyLjIwNC4yMjgiLCJuYW1lIjoiRm9ycmVzdCBHdW1wIiwib2lkIjoiOTBmNzU5NmItODhiNi00NzY4LTgyMDQtOGM0NzZhNzNmZTI1IiwicmgiOiIwLkFiY0FxWVhtMVNNLTJVS2UtaFhNWEJ6bjJ4TldoT014QThCSm54SDdhbU5DUXRMOEFQVS4iLCJzdWIiOiJLR2NlTEgtSG9FTklONUg0alZ3d2FMSTJydHBILVMyQ1RuSkNIQTB5MGFrIiwidGlkIjoiZDVlNjg1YTktM2UyMy00MmQ5LTllZmEtMTVjYzVjMWNlN2RiIiwidW5pcXVlX25hbWUiOiJGb3JyZXN0R3VtcEBHaXRjb2lucy5vbm1pY3Jvc29mdC5jb20iLCJ1cG4iOiJGb3JyZXN0R3VtcEBHaXRjb2lucy5vbm1pY3Jvc29mdC5jb20iLCJ1dGkiOiJ4TTF0eGxqTnJreWt6UktodnA0NEFBIiwidmVyIjoiMS4wIn0.gvCI4lh_flmOLW5Z4-uLqMC3mnGLMXMdgNtRb8I-wn5KYs1pLzkQiKuthd_BwTO2C40hWzxu8-ghtRqHeUF7SYU9ZCAJja9P6vAKp1gds1XFKXwes68B2FFT8pfcixwXWVH8kIIt1gepoxNVZbg5s5wNDRpmg8uAsp_QD00rqxyPYIs5fZ4W7bRL8CLXj9DB1tiXK-AB8h45OZ0z6_j2aPWaMYDD63iPSiPAZtUfw3vjetrawSK-WWTR_Y0NTC5LO9dmWAdnq2U3wlUQYfqJ-oTQ3Qo_Xlp-uNYv2HgtMNLO63vYOOFyzdoyPxNTvV4PNLrQZFRyjYjDCUEB_UoZog'
  };

  res.json(tokenResponse);
        }
    }

    /**
     * Instantiates a new MSAL ConfidentialClientApplication object
     * @param msalConfig: MSAL Node Configuration object 
     * @returns 
     */
    getMsalInstance(msalConfig) {
        return new msal.ConfidentialClientApplication(msalConfig);
    }


    /**
     * Prepares the auth code request parameters and initiates the first leg of auth code flow
     * @param req: Express request object
     * @param res: Express response object
     * @param next: Express next function
     * @param authCodeUrlRequestParams: parameters for requesting an auth code url
     * @param authCodeRequestParams: parameters for requesting tokens using auth code
     */
    redirectToAuthCodeUrl(authCodeUrlRequestParams, authCodeRequestParams, msalInstance) {
        return async (req, res, next) => {
            // Generate PKCE Codes before starting the authorization flow
            const { verifier, challenge } = await this.cryptoProvider.generatePkceCodes();

            // Set generated PKCE codes and method as session vars
            req.session.pkceCodes = {
                challengeMethod: 'S256',
                verifier: verifier,
                challenge: challenge,
            };

            /**
             * By manipulating the request objects below before each request, we can obtain
             * auth artifacts with desired claims. For more information, visit:
             * https://azuread.github.io/microsoft-authentication-library-for-js/ref/modules/_azure_msal_node.html#authorizationurlrequest
             * https://azuread.github.io/microsoft-authentication-library-for-js/ref/modules/_azure_msal_node.html#authorizationcoderequest
             **/
            req.session.authCodeUrlRequest = {
                ...authCodeUrlRequestParams,
                responseMode: msal.ResponseMode.FORM_POST, // recommended for confidential clients
                codeChallenge: req.session.pkceCodes.challenge,
                codeChallengeMethod: req.session.pkceCodes.challengeMethod,
            };

            req.session.authCodeRequest = {
                ...authCodeRequestParams,
                code: '',
            };

            try {
                const authCodeUrlResponse = await msalInstance.getAuthCodeUrl(req.session.authCodeUrlRequest);
                res.redirect(authCodeUrlResponse);
            } catch (error) {
                next(error);
            }
        };
    }

    /**
     * Retrieves cloud discovery metadata from the /discovery/instance endpoint
     * @returns 
     */
    async getCloudDiscoveryMetadata(authority) {
        const endpoint = 'https://login.microsoftonline.com/common/discovery/instance';

        try {
            const response = await axios.get(endpoint, {
                params: {
                    'api-version': '1.1',
                    'authorization_endpoint': `${authority}/oauth2/v2.0/authorize`
                }
            });

            return await response.data;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Retrieves oidc metadata from the openid endpoint
     * @returns
     */
    async getAuthorityMetadata(authority) {
        const endpoint = `${authority}/v2.0/.well-known/openid-configuration`;

        try {
            const response = await axios.get(endpoint);
            return await response.data;
        } catch (error) {
            console.log(error);
        }
    }
}

const authProvider = new AuthProvider(msalConfig);

module.exports = authProvider;