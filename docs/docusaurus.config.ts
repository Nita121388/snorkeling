import type { Config } from "@docusaurus/types";
import rehypeHighlight from "rehype-highlight";
import { docOgRenderer } from "./src/renderer/image-renderers";

const baseUrl = process.env.EMBEDDED ? "/docsite/" : process.env.DOCSITE_BASE_URL || "/";
const generateOgImages = !process.env.EMBEDDED && process.env.GENERATE_OG_IMAGES === "1";

const config: Config = {
    title: "Snorkeling Documentation",
    tagline: "AI coding workflows built on Wave Terminal",
    favicon: "img/logo/snorkeling-logo.svg",

    // Set the production url of your site here
    url: "https://nita121388.github.io",
    // Set the /<baseUrl>/ pathname under which your site is served
    // For GitHub pages deployment, it is often '/<projectName>/'
    baseUrl,

    // GitHub pages deployment config.
    // If you aren't using GitHub pages, you don't need these.
    organizationName: "Nita121388", // Usually your GitHub org/user name.
    projectName: "snorkeling", // Usually your repo name.
    deploymentBranch: "main",

    onBrokenAnchors: "ignore",
    onBrokenLinks: "throw",
    onBrokenMarkdownLinks: "warn",
    trailingSlash: false,

    // Even if you don't use internationalization, you can use this field to set
    // useful metadata like html lang. For example, if your site is Chinese, you
    // may want to replace "en" with "zh-Hans".
    i18n: {
        defaultLocale: "en",
        locales: ["en", "zh-Hans"],
        localeConfigs: {
            en: {
                label: "English",
            },
            "zh-Hans": {
                label: "简体中文",
                htmlLang: "zh-Hans",
            },
        },
    },
    plugins: [
        [
            "content-docs",
            {
                path: "docs",
                routeBasePath: "/",
                exclude: ["features/**"],
                editUrl: !process.env.EMBEDDED ? "https://github.com/Nita121388/snorkeling/edit/main/docs/" : undefined,
                rehypePlugins: [rehypeHighlight],
            } as import("@docusaurus/plugin-content-docs").Options,
        ],
        "ideal-image",
        [
            "@docusaurus/plugin-sitemap",
            {
                changefreq: "daily",
                filename: "sitemap.xml",
            },
        ],
        generateOgImages && [
            "@waveterm/docusaurus-og",
            {
                path: "./preview-images", // relative to the build directory
                imageRenderers: {
                    "docusaurus-plugin-content-docs": docOgRenderer,
                },
            },
        ],
        "docusaurus-plugin-sass",
        "@docusaurus/plugin-svgr",
    ].filter((v) => v),
    themes: [["classic", { customCss: "src/css/custom.scss" }]],
    themeConfig: {
        docs: {
            sidebar: {
                hideable: false,
                autoCollapseCategories: false,
            },
        },
        colorMode: {
            defaultMode: "light",
            disableSwitch: false,
            respectPrefersColorScheme: true,
        },
        navbar: {
            logo: {
                src: "img/logo/snorkeling-logo.svg",
                srcDark: "img/logo/snorkeling-logo.svg",
                href: "https://github.com/Nita121388/snorkeling",
            },
            hideOnScroll: true,
            items: [
                {
                    type: "doc",
                    position: "left",
                    docId: "index",
                    label: "Docs",
                },
                !process.env.EMBEDDED
                    ? [
                          {
                              href: "https://github.com/Nita121388/snorkeling",
                              position: "right",
                              className: "header-link-custom custom-icon-github",
                              "aria-label": "GitHub repository",
                          },
                      ]
                    : [],
                {
                    type: "localeDropdown",
                    position: "right",
                },
            ].flat(),
        },
        metadata: [
            {
                name: "keywords",
                content:
                    "snorkeling, wave terminal, terminal, developer, development, command, line, linux, macos, windows, connection, ssh, cli, wsh, documentation, docs, ai, agent, codex, claude, widgets, remote, open source, go, golang, react, typescript, javascript",
            },
            {
                name: "og:type",
                content: "website",
            },
            {
                name: "og:site_name",
                content: "Snorkeling Documentation",
            },
            {
                name: "application-name",
                content: "Snorkeling Documentation",
            },
            {
                name: "apple-mobile-web-app-title",
                content: "Snorkeling Documentation",
            },
        ],
        footer: {
            copyright: `Copyright © ${new Date().getFullYear()} Snorkeling contributors. Built with Docusaurus.`,
        },
    },
    headTags: [
        {
            tagName: "link",
            attributes: {
                rel: "preload",
                as: "font",
                type: "font/woff2",
                "data-next-font": "size-adjust",
                href: `${baseUrl}fontawesome/webfonts/fa-sharp-regular-400.woff2`,
            },
        },
        {
            tagName: "link",
            attributes: {
                rel: "preload",
                as: "font",
                type: "font/woff2",
                "data-next-font": "size-adjust",
                href: `${baseUrl}fontawesome/webfonts/fa-sharp-solid-900.woff2`,
            },
        },
        {
            tagName: "link",
            attributes: {
                rel: "sitemap",
                type: "application/xml",
                title: "Sitemap",
                href: `${baseUrl}sitemap.xml`,
            },
        },
    ].filter((v) => v),
    stylesheets: [
        `${baseUrl}fontawesome/css/fontawesome.min.css`,
        `${baseUrl}fontawesome/css/sharp-regular.min.css`,
        `${baseUrl}fontawesome/css/sharp-solid.min.css`,
    ],
    staticDirectories: ["static", "storybook"],
};

export default config;
