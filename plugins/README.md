# plugins/

每个子目录 = 一个插件，目录名必须等于 `manifest.json` 里的 `id`。

```text
plugins/<插件 id>/
├─ manifest.json
├─ index.js
└─ index.js.sha256
```

- 这里放的**永远是当前版本**；历史版本不用另建目录，平台发布时会把 commit 与 sha256 钉进登记表。
- 三件套怎么生成、指纹怎么算、CI 查哪五条：见仓库根的 `README.md`。
- 插件怎么写：宿主仓库的《教室端插件开发手册.md》。

（这个文件只是为了让 `plugins/` 目录在 git 里存在；有第一个插件后可以删掉它。）
