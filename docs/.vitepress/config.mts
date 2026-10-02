import { defineConfig } from "vitepress";

export default defineConfig({
  title: "wa-mcp",
  description: "WhatsApp MCP server — local bridge, 30 tools, zero-dep",
  base: "/wa-mcp/",
  themeConfig: {
    nav: [
      { text: "Getting started", link: "/getting-started/" },
      { text: "Tools", link: "/reference/tools" },
      { text: "Configuration", link: "/configuration" },
      { text: "Security", link: "/security" },
      { text: "Development", link: "/development" },
    ],
    sidebar: [
      { text: "Getting started", link: "/getting-started/" },
      { text: "Tool reference", link: "/reference/tools" },
      { text: "Configuration", link: "/configuration" },
      { text: "Security", link: "/security" },
      { text: "Development", link: "/development" },
      {
        text: "ADRs",
        items: [
          { text: "0001 Engine choice", link: "/adr/0001-engine-choice" },
          { text: "0002 Zero-dep bridge", link: "/adr/0002-zero-dep-bridge" },
          { text: "0003 Monorepo vite-plus", link: "/adr/0003-monorepo-vite-plus" },
          { text: "0004 Security model", link: "/adr/0004-security-model" },
          { text: "0005 Hand-rolled MCP", link: "/adr/0005-hand-rolled-mcp" },
          { text: "0006 Vanilla web UI", link: "/adr/0006-vanilla-web-ui" },
          { text: "0007 Store schema", link: "/adr/0007-store-schema" },
          { text: "0008 Send safety", link: "/adr/0008-send-safety" },
          { text: "0009 Census-first scope", link: "/adr/0009-census-first-scope" },
          { text: "0010 No-publish", link: "/adr/0010-no-publish" },
        ],
      },
    ],
  },
});
