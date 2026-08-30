# SEO 分析工具 — Cloudflare Pages 版

## 文件结构

```
seo-tool-cf/
├── functions/
│   └── api/
│       ├── test.js                   # 测试连接
│       └── dataforseo/
│           └── [[path]].js           # DataForSEO API 代理
└── public/
    └── index.html                    # 前端页面
```

## 部署步骤

### 第一步：上传到 GitHub
1. 去 github.com 注册/登录
2. 点右上角 "+" → "New repository"
3. 填写仓库名（如 seo-tool），点 Create
4. 把 seo-tool-cf 文件夹里的所有文件上传

### 第二步：部署到 Cloudflare Pages
1. 去 https://pages.cloudflare.com 登录（没有账号免费注册）
2. 点 "Create a project" → "Connect to Git"
3. 选择你刚才创建的 GitHub 仓库
4. 配置如下：
   - Framework preset: None
   - Build command: （留空）
   - Build output directory: public
5. 点 "Save and Deploy"

等待 1-2 分钟，部署完成后会得到一个网址，例如：
https://seo-tool-xxx.pages.dev

### 第三步：使用
打开网址，填入 DataForSEO 的 Login 和 Password，点测试连接即可。

SEO Pro V2 development branch.

## SEO Pro V2 interface

The Preview entry at `/v2` uses a hash-routed personal dashboard. Stable views are `#overview`, `#website`, `#competitors`, `#keywords`, `#backlinks`, `#opportunities`, `#more`, `#sites`, and `#settings`.

Managed site profiles are stored locally under `seo-pro-v2.site-profiles.v1`. Selecting a site only fills compatible domain fields; it never submits a form or authorizes a paid DataForSEO request.

Static assets and API calls use relative or origin-relative URLs. Moving the application to a custom domain requires binding that domain to the same Cloudflare Pages project and configuring the existing environment bindings and secrets; source hostnames do not need rewriting.
