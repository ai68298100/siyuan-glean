import test from "node:test";
import assert from "node:assert/strict";
import {
    isWechatUrl, isWechatImage, extractWechatAuthor, cleanWechatNoise, extractWechatTime, extractWechatSeries,
    repairWechatImages, extractWechatCover, extractWechatDescription, cleanWechatArticleUrl, wechatArticleToWereadUrl,
    repairWechatMath, repairWechatCode, repairWechatVoice, repairWechatContent, extractWechatAvatar, extractWechatBiz,
    repairWechatBackgroundImages, repairWechatVideos,
} from "../src/domain/wechat.ts";

test("isWechatUrl：准确识别 mp.weixin.qq.com 及子域名", () => {
    assert.equal(isWechatUrl("https://mp.weixin.qq.com/s/abcdef123"), true);
    assert.equal(isWechatUrl("http://weixin.qq.com/r/xyz"), true);
    assert.equal(isWechatUrl("https://sub.weixin.qq.com/test"), true);
    assert.equal(isWechatUrl("https://zhihu.com/question/123"), false);
    assert.equal(isWechatUrl(""), false);
    assert.equal(isWechatUrl(undefined), false);
    assert.equal(isWechatUrl("not a url"), false);
});

test("isWechatImage：识别 mmbiz.qpic.cn 微信图片域名", () => {
    assert.equal(isWechatImage("https://mmbiz.qpic.cn/mmbiz_jpg/xyz/0?wx_fmt=jpeg"), true);
    assert.equal(isWechatImage("http://wx.qpic.cn/test.png"), true);
    assert.equal(isWechatImage("https://pic.zhihu.com/v2-xxx.jpg"), false);
    assert.equal(isWechatImage(""), false);
    assert.equal(isWechatImage(undefined), false);
});

test("extractWechatAuthor：从 HTML js_name 或 profile_nickname 提取公众号", () => {
    const htmlSnippet1 = `
    # 深度解读人工智能最新趋势
    <div class="rich_media_meta_list">
        <span class="rich_media_meta rich_media_meta_text">
            <a href="javascript:void(0);" class="appmsg_skin_primary" id="js_name">机器之心</a>
        </span>
    </div>
    正文内容开始...
    `;
    assert.equal(extractWechatAuthor(htmlSnippet1), "机器之心");

    const htmlSnippet2 = `
    # 另一个测试
    <strong class="profile_nickname">晚点LatePost</strong>
    正文开始
    `;
    assert.equal(extractWechatAuthor(htmlSnippet2), "晚点LatePost");

    const htmlSnippet3 = `
    <meta property="og:site_name" content="差评" />
    <h1>标题</h1>
    `;
    assert.equal(extractWechatAuthor(htmlSnippet3), "差评");
});

test("extractWechatAuthor：从 Markdown 行提取明确公众号名称", () => {
    const md1 = `
# 某篇精彩文章

- 公众号：新世相
- 来源：https://mp.weixin.qq.com/s/123

正文第一段...
    `;
    assert.equal(extractWechatAuthor(md1), "新世相");

    const md2 = `
# 另一篇

**公众号**：**36氪**

正文
    `;
    assert.equal(extractWechatAuthor(md2), "36氪");
});

test("extractWechatAuthor：从微信特有原创标头提取", () => {
    const md = `
# 文章标题

原创 差评 2024-05-01 12:00 发表于浙江

今天我们聊聊新的数码产品...
    `;
    assert.equal(extractWechatAuthor(md), "差评");

    const mdQuote = `
# 标题
> 原创 硅星人Pro
正文
    `;
    assert.equal(extractWechatAuthor(mdQuote), "硅星人Pro");
});

test("extractWechatAuthor：从剪藏模板链接形式提取", () => {
    const md = `
# 标题
- [极客公园 · 微信公众号](https://mp.weixin.qq.com/s/abc)

正文
    `;
    assert.equal(extractWechatAuthor(md), "极客公园");
});

test("extractWechatAuthor：黑名单过滤通用词与空值防护", () => {
    assert.equal(extractWechatAuthor(""), null);
    assert.equal(extractWechatAuthor("原创 微信公众号"), null);
    assert.equal(extractWechatAuthor("公众号：阅读原文"), null);
    assert.equal(extractWechatAuthor("没有公众号信息的普通文章\n今天天气真好"), null);
});

test("cleanWechatNoise：清除合集、蓝字关注、点赞等噪点行", () => {
    const input = [
        "# 文章标题",
        "收录于合集 #深度报道 12个",
        "点击上方蓝字关注我们，获取最新资讯",
        "这是真正的正文第一段。",
        "这是正文第二段。",
        "喜欢本文请点赞在看转发！",
        "长按二维码关注本公众号",
        "后台回复【架构】领取大厂资料",
        "商务合作请联系微信：abc1234",
        "排版设计：小李",
        "秀米XIUMI 优质排版平台",
        "点击下方“阅读原文”查看详情",
    ].join("\n");

    const cleaned = cleanWechatNoise(input);
    assert.ok(!cleaned.includes("收录于合集"));
    assert.ok(!cleaned.includes("点击上方蓝字关注"));
    assert.ok(!cleaned.includes("喜欢本文请点赞"));
    assert.ok(!cleaned.includes("长按二维码"));
    assert.ok(!cleaned.includes("后台回复"));
    assert.ok(!cleaned.includes("商务合作"));
    assert.ok(!cleaned.includes("排版设计"));
    assert.ok(!cleaned.includes("秀米XIUMI"));
    assert.ok(!cleaned.includes("阅读原文"));
    assert.ok(cleaned.includes("这是真正的正文第一段。"));
    assert.ok(cleaned.includes("这是正文第二段。"));
});

test("extractWechatTime：从 HTML 节点、JS 变量或前置文本提取发布时间", () => {
    const html1 = '<em id="publish_time">2024-05-20 18:30</em>';
    assert.equal(extractWechatTime(html1), "20240520183000");

    const html2 = '<em id="publish_time">2024-05-20</em>';
    assert.equal(extractWechatTime(html2), "20240520000000");

    const jsCode = "var createDate = '2023-11-15 09:45:30';\nvar publish_time = '2023-11-15';";
    assert.equal(extractWechatTime(jsCode), "20231115094530");

    const md1 = "# 标题\n原创 晚点团队 2024年03月12日 14:20\n正文开始...";
    assert.equal(extractWechatTime(md1), "20240312142000");

    const md2 = "# 标题\n- 发布时间：2024-01-05\n正文开始...";
    assert.equal(extractWechatTime(md2), "20240105000000");

    // 非法日期安全返回 null
    assert.equal(extractWechatTime("2024-02-31"), null);
    assert.equal(extractWechatTime("无日期普通文章"), null);
});

test("extractWechatSeries：精准提取微信合集/专栏系列名称", () => {
    const md1 = `
# 大模型时代下的工程师成长
收录于合集 #大模型深度探索 18个
原创 张三 2024-04-10
正文开始...
    `;
    assert.equal(extractWechatSeries(md1), "大模型深度探索");

    const md2 = `
# 商业分析
- 收录于专栏 #科技商业观察
正文...
    `;
    assert.equal(extractWechatSeries(md2), "科技商业观察");

    const html1 = `
    <h1>文章标题</h1>
    <div class="album__content_item">#具身智能前沿研究 · 12篇</div>
    正文...
    `;
    assert.equal(extractWechatSeries(html1), "具身智能前沿研究");

    // 通用词黑名单过滤与无合集文章防护
    assert.equal(extractWechatSeries("收录于合集 #合集"), null);
    assert.equal(extractWechatSeries("普通文章，没有合集信息"), null);
});

test("repairWechatImages：将 data-src 懒加载图片转换为有效 Markdown 图片", () => {
    const htmlWithDataSrc = `
# 标题
正文段落
<img class="rich_pages wxw-img" data-ratio="0.5625" data-w="1080" data-src="https://mmbiz.qpic.cn/mmbiz_png/abc123/640?wx_fmt=png" src="data:image/svg+xml,..." alt="架构流程图" />
后文段落
<img data-src="https://mmbiz.qpic.cn/sample.jpg" />
<img src="https://example.com/normal.png" alt="普通图片" />
`;

    const repaired = repairWechatImages(htmlWithDataSrc);
    assert.ok(repaired.includes("![架构流程图](https://mmbiz.qpic.cn/mmbiz_png/abc123/640?wx_fmt=png)"));
    assert.ok(repaired.includes("![图片](https://mmbiz.qpic.cn/sample.jpg)"));
    assert.ok(repaired.includes('<img src="https://example.com/normal.png" alt="普通图片" />'));
});

test("extractWechatCover：准确提取官方封面图大图 URL", () => {
    const html1 = '<meta property="og:image" content="https://mmbiz.qpic.cn/mmbiz_jpg/cover123/0" />';
    assert.equal(extractWechatCover(html1), "https://mmbiz.qpic.cn/mmbiz_jpg/cover123/0");

    const js1 = 'var msg_cdn_url = "https://mmbiz.qpic.cn/cover.jpg";';
    assert.equal(extractWechatCover(js1), "https://mmbiz.qpic.cn/cover.jpg");

    assert.equal(extractWechatCover("无图片普通文档"), null);
});

test("extractWechatDescription：提取官方作者简介或摘要", () => {
    const html = '<meta property="og:description" content="这是一篇关于大语言模型最新前沿的深度研究报告。" />';
    assert.equal(extractWechatDescription(html), "这是一篇关于大语言模型最新前沿的深度研究报告。");

    const js = 'var msg_desc = "官方简介内容测试";';
    assert.equal(extractWechatDescription(js), "官方简介内容测试");
});

test("cleanWechatArticleUrl：剥离微信长参数生成永久纯净短链", () => {
    const trackedUrl = "https://mp.weixin.qq.com/s/abcdef123456?chksm=xyz&mpshare=1&scene=21&subscene=0&ascene=7&devicetype=iOS";
    assert.equal(cleanWechatArticleUrl(trackedUrl), "https://mp.weixin.qq.com/s/abcdef123456");

    const bizUrl = "https://mp.weixin.qq.com/s?__biz=MzA1MjM=&mid=265&idx=1&sn=999&chksm=aaa#rd";
    assert.equal(cleanWechatArticleUrl(bizUrl), "https://mp.weixin.qq.com/s?__biz=MzA1MjM=&mid=265&idx=1&sn=999#rd");
});

test("wechatArticleToWereadUrl：生成微信读书网页版无障碍阅读链接", () => {
    const url = "https://mp.weixin.qq.com/s/abcdef123?chksm=test";
    const weread = wechatArticleToWereadUrl(url);
    assert.equal(weread, "https://weread.qq.com/web/reader/https%3A%2F%2Fmp.weixin.qq.com%2Fs%2Fabcdef123");
    assert.equal(wechatArticleToWereadUrl("https://zhihu.com/question/1"), null);
});

test("repairWechatMath：将微信公式标签精准还原为 Markdown LaTeX 公式", () => {
    const inlineMath = '这是质能方程 <img class="js_dark_latex" data-formula="E = mc^2" alt="formula" /> 测试。';
    assert.equal(repairWechatMath(inlineMath), "这是质能方程 $E = mc^2$ 测试。");

    const blockMath = '求和公式：<span class="block-equation" data-formula="\\sum_{i=1}^n i = \\frac{n(n+1)}{2}" data-formula-type="block">公式占位</span>。';
    assert.equal(repairWechatMath(blockMath), "求和公式：\n\n$$\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n$$\n\n。");

    const entityMath = '<svg data-formula="a &lt; b &amp;&amp; c &gt; d"></svg>';
    assert.equal(repairWechatMath(entityMath), "$a < b && c > d$");
});

test("repairWechatCode：提取微信代码容器，剔除行号并转为标准代码块", () => {
    const wechatCodeHtml = `
<pre class="js_dark_code" data-lang="python">
<span class="code-snippet__line-index">1</span><span class="token-keyword">def</span> <span class="token-title">hello</span>():
<span class="code-snippet__line-index">2</span>    print(&quot;Hello, WeChat&quot;)
</pre>
`;
    const repaired = repairWechatCode(wechatCodeHtml);
    assert.ok(repaired.includes("```python"));
    assert.ok(repaired.includes('def hello():\n    print("Hello, WeChat")'));
    assert.ok(!repaired.includes("code-snippet__line-index"));
});

test("repairWechatVoice：将微信内嵌语音条转换为美观的音频引述块", () => {
    const voiceHtml = '<mpvoice name="晚安电台·第12期" play_length="185" voice_encode_fileid="voice_123"></mpvoice>';
    const repaired = repairWechatVoice(voiceHtml);
    assert.ok(repaired.includes("🎙️ **音频**：晚安电台·第12期 (3:05)"));
    assert.ok(repaired.includes("微信内嵌音频组件"));
});

test("extractWechatAvatar & extractWechatBiz：提取公众号圆形头像与唯一业务 ID", () => {
    const htmlWithAvatar = `
    var round_head_img = "https://mmbiz.qpic.cn/avatar/123/0";
    var __biz = "MzA1MjM5OTk5";
    `;
    assert.equal(extractWechatAvatar(htmlWithAvatar), "https://mmbiz.qpic.cn/avatar/123/0");
    assert.equal(extractWechatBiz(htmlWithAvatar), "MzA1MjM5OTk5");

    const urlWithBiz = "https://mp.weixin.qq.com/s?__biz=Mzg4NzAxMTE0Mw==&mid=2247483842";
    assert.equal(extractWechatBiz(urlWithBiz), "Mzg4NzAxMTE0Mw==");
});

test("repairWechatBackgroundImages：提取 CSS background-image 插图并还原为 Markdown 图片", () => {
    const bgHtml = `
<section style="background-image: url(&quot;https://mmbiz.qpic.cn/mmbiz_jpg/infographic/640&quot;); background-size: cover;">
    这是插图上方的文字描述。
</section>
`;
    const repaired = repairWechatBackgroundImages(bgHtml);
    assert.ok(repaired.includes("![插图](https://mmbiz.qpic.cn/mmbiz_jpg/infographic/640)"));
    assert.ok(repaired.includes("这是插图上方的文字描述。"));
});

test("repairWechatVideos：将微信内嵌腾讯视频与视频号转换为播放引导卡片", () => {
    const iframeHtml = '<iframe class="video_iframe" src="https://v.qq.com/iframe/player.html?vid=v0045test123&auto=0"></iframe>';
    const repIframe = repairWechatVideos(iframeHtml);
    assert.ok(repIframe.includes("🎬 **内嵌视频**：[在腾讯视频中播放](https://v.qq.com/x/page/v0045test123.html)"));

    const mpvideoHtml = '<mpvideo title="科技发布会精简版" data-src="https://mp.weixin.qq.com/mpvideo?vid=999"></mpvideo>';
    const repMpvideo = repairWechatVideos(mpvideoHtml);
    assert.ok(repMpvideo.includes("🎬 **微信视频**：科技发布会精简版 ([观看视频](https://mp.weixin.qq.com/mpvideo?vid=999))"));
});

test("repairWechatContent：串联执行全套正文提纯（图片懒加载/背景图/视频/公式/代码/语音）", () => {
    const fullArticle = `
# 综合文章测试
<img data-src="https://mmbiz.qpic.cn/img1.png" alt="图1" />
<section style="background-image: url('https://mmbiz.qpic.cn/img2.jpg');">长图内容</section>
<iframe class="video_iframe" vid="abc789"></iframe>
<img data-formula="x^2 + y^2 = r^2" />
<pre class="js_dark_code" data-lang="js"><code><span class="code-snippet__line-index">1</span>console.log("ok");</code></pre>
<mpvoice name="作者说" play_length="60"></mpvoice>
`;
    const repaired = repairWechatContent(fullArticle);
    assert.ok(repaired.includes("![图1](https://mmbiz.qpic.cn/img1.png)"));
    assert.ok(repaired.includes("![插图](https://mmbiz.qpic.cn/img2.jpg)"));
    assert.ok(repaired.includes("在腾讯视频中播放"));
    assert.ok(repaired.includes("$x^2 + y^2 = r^2$"));
    assert.ok(repaired.includes('```js\nconsole.log("ok");\n```'));
    assert.ok(repaired.includes("🎙️ **音频**：作者说 (1:00)"));
});





