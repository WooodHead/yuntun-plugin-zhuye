"use strict";
// Express requirements
import path from "path";
import fs from "fs";

// React requirements
import React from "react";
import { renderToString } from "react-dom/server";
import Helmet from "react-helmet";
import { Provider } from "react-redux";
import { StaticRouter } from "react-router";
import { Frontload, frontloadServerRender } from "react-frontload";
import { ServerStyleSheet } from "styled-components";
import Loadable from "react-loadable";
import { IntlProvider, addLocaleData } from "react-intl";

// Our store, entrypoint, and manifest
import createStore from "./dist/src/store";
import App from "./dist/src/app/app";
import manifest from "./build/asset-manifest.json";

// Some optional Redux functions related to user authentication
import { setCurrentUser, logoutUser } from "./dist/src/modules/auth";

async function handlSSR(request, h) {
  /*
      A simple helper function to prepare the HTML markup. This loads:
        - Page title
        - SEO meta tags
        - Preloaded state (for Redux) depending on the current route
        - Code-split script tags depending on the current route
    */
  const injectHTML = (data, { html, title, meta, body, scripts, styles, state }) => {
    data = data.replace("<html>", `<html ${html}>`);
    data = data.replace(/<title>.*?<\/title>/g, title);
    data = data.replace("</head>", `${meta}${styles}</head>`);
    data = data.replace(
      '<div id="root"></div>',
      `<div id="root">${body}</div><script>window.__PRELOADED_STATE__ = ${state}</script>`
    );
    data = data.replace("</body>", scripts.join("") + "</body>");

    return data;
  };

  // Load in our HTML file from our build
  try {
    const htmlData = fs.readFileSync(
      path.resolve(__dirname, "./build/index.html"),
      "utf8"
    );
    // Create a store (with a memory history) from our current url
    const { store } = createStore(request.url);

    // If the user has a cookie (i.e. they're signed in) - set them as the current user
    // Otherwise, we want to set the current state to be logged out, just in case this isn't the default
    if ("mywebsite" in request.state) {
      store.dispatch(setCurrentUser(request.state.mywebsite));
    } else {
      store.dispatch(logoutUser());
    }

    const sheet = new ServerStyleSheet();
    const context = {};
    const modules = [];

    /*
          Here's the core funtionality of this file. We do the following in specific order (inside-out):
            1. Load the <App /> component
            2. Inside of the Frontload HOC
            3. Inside of a Redux <StaticRouter /> (since we're on the server), given a location and context to write to
            4. Inside of the store provider
            5. Inside of the React Loadable HOC to make sure we have the right scripts depending on page
            6. Render all of this sexiness
            7. Make sure that when rendering Frontload knows to get all the appropriate preloaded requests

          In English, we basically need to know what page we're dealing with, and then load all the appropriate scripts and
          data for that page. We take all that information and compute the appropriate state to send to the user. This is
          then loaded into the correct components and sent as a Promise to be handled below.
        */
    const routeMarkup = await frontloadServerRender(() =>
      renderToString(
        sheet.collectStyles(
          <Loadable.Capture report={m => modules.push(m)}>
            <Provider store={store}>
              <IntlProvider locale="zh" defaultLocale="zh">
                <StaticRouter location={request.url} context={context}>
                  <Frontload isServer={true}>
                    <App />
                  </Frontload>
                </StaticRouter>
              </IntlProvider>
            </Provider>
          </Loadable.Capture>
        )
      )
    );
    if (context.url) {
      // If context has a url property, then we need to handle a redirection in Redux Router
      return h
        .response("redirect...")
        .code(302)
        .header("Location", context.url);
    } else {
      // Otherwise, we carry on...

      // Let's give ourself a function to load all our page-specific JS assets for code splitting
      const extractAssets = (assets, chunks) =>
        Object.keys(assets)
          .filter(asset => chunks.indexOf(asset.replace(".js", "")) > -1)
          .map(k => assets[k]);

      // Let's format those assets into pretty <script> tags
      const extraChunks = extractAssets(manifest, modules).map(
        c =>
          `<script type="text/javascript" src="${c.replace(
            /^\//,
            ""
          )}"></script>`
      );

      // We need to tell Helmet to compute the right meta tags, title, and such
      const helmet = Helmet.renderStatic();

      // NOTE: Disable if you desire
      // Let's output the title, just to see SSR is working as intended

      // Pass all this nonsense into our HTML formatting function above
      const html = injectHTML(htmlData, {
        html: helmet.htmlAttributes.toString(),
        title: helmet.title.toString(),
        meta: helmet.meta.toString(),
        body: routeMarkup,
        scripts: extraChunks,
        styles: sheet.getStyleTags(),
        state: JSON.stringify(store.getState()).replace(/</g, "\\u003c")
      });

      // We have all the final HTML, let's send it to the user already!
      // res.send(html);
      // return h.response(html);
      return html;
    }
  } catch (err) {
    console.error("Read error", err);
    return h.response().code(404);
  }
}

exports.register = function(server, options, next) {
  server.route([
    {
      method: "GET",
      path: "/{param*}",
      config: {
        auth: false,
        handler: handlSSR,
        tags: ["web"]
      }
    }
  ]);
};
exports.name = "yuntun-plugin-zhuye";
exports.multiple = true;
