# ImageForge Studio 复刻部署

这是一个静态前端版本，直接调用你的 New API 兼容接口：

- 默认接口地址：`https://apichat.jiazhuangai.com`
- 默认文生图模型：`gpt-image-2`
- 默认图生图/编辑模型：`gpt-image-2`
- 润色/反推模型默认：`agnes-2.0-flash`
- API Key 保存在浏览器 `localStorage`，不会写进代码仓库

## 本地预览

```bash
python -m http.server 5200
```

打开 `http://localhost:5200`。

## 网页配置

打开右上角设置，填写：

- `接口地址`：`https://apichat.jiazhuangai.com`
- `API Key`：你的 New API Key
- `文生图模型`：纯文字生成图片使用，例如 `gpt-image-2`、`Qwen/Qwen-Image`
- `图生图/编辑模型`：上传参考图、商品图、遮罩编辑使用，例如 `gpt-image-2`、`Qwen/Qwen-Image-Edit`
- `润色模型`：可选，对应聊天模型别名

接口地址可以填根地址或带 `/v1` 的地址，前端会自动规整成根地址后再请求 `/v1/...`。

Qwen 图片模型会按硅基流动接口格式请求：`Qwen/Qwen-Image` 走 `/v1/images/generations`，并使用硅基推荐的 `image_size` 参数。

硅基流动的图片返回可能是 `images[0].url`，页面已兼容该格式。

硅基流动的 `Qwen/Qwen-Image-Edit` 使用 `/v1/images/generations`，请求体里的图片字段为 JSON `image`，不是 OpenAI 的 multipart `/v1/images/edits`；页面已按该格式处理。若你的中转仍返回 400，请在 New API 渠道里同时加入硅基文档示例模型 `Qwen/Qwen-Image-Edit-2509` 再测试。

所有请求默认都经过你的 New API 中转站，不包含第三方直连配置。

## Docker 部署

```bash
docker compose up -d --build
```

部署后访问服务器的 `520` 端口。

## 1Panel Docker 部署

推荐用 1Panel 的“容器编排”部署：

1. 进入 1Panel，确认 Docker 已安装。
2. 打开 `容器` -> `编排` -> `创建编排`。
3. 编排名称填写 `createimage`。
4. 如果 1Panel 支持 Git 仓库方式，仓库地址填写：

```text
https://github.com/mypengpengli/createimage.git
```

5. 如果你习惯先在服务器拉代码：

```bash
git clone https://github.com/mypengpengli/createimage.git
cd createimage
docker compose up -d --build
```

6. 启动后访问：

```text
http://你的服务器IP:520
```

7. 后续更新：

```bash
cd createimage
git pull
docker compose up -d --build
```

如果在 1Panel 的“网站”里配置反向代理，目标地址填：

```text
http://127.0.0.1:520
```

## Nginx 静态部署

把这些文件放到站点目录：

```text
index.html
style.css
app.js
gallery-cases.js
```

Nginx 站点可以参考 `nginx.conf`。如果用域名和 HTTPS，建议在反向代理或宝塔面板里把站点根目录指向这些文件所在目录。

## 注意

这个版本是浏览器直连 `https://apichat.jiazhuangai.com/v1/...`。你的 New API 服务需要允许部署域名的 CORS 请求；如果网页测试连接提示 `Failed to fetch` 或 `跨域错误 (CORS)`，需要在 New API/反代层放行跨域，或再加一层同域后端代理。

案例区数据已本地化为 `gallery-cases.js`，案例图片仍使用原远程图片 URL，以减少部署体积。

## 资源占用

这是静态前端应用，不在服务器保存生成图片，不需要数据库，也不在服务器跑模型。生成历史保存在访问者浏览器本地 IndexedDB。服务器主要消耗是 Nginx 静态文件流量和少量磁盘空间。
