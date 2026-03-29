cat > scripts/publish.js << 'EOF'
const fs = require("fs");
const axios = require("axios");

const BLOG_ID = process.env.BLOG_ID;
const TOKEN = process.env.BLOGGER_TOKEN;

async function publishPost(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const title = filePath.split("/").pop().replace(".html", "");

    const response = await axios.post(
      `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`,
      {
        kind: "blogger#post",
        title: title,
        content: content
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`
        }
      }
    );

    console.log("Publicado:", response.data.url);
  } catch (error) {
    console.error("Erro:", error.response?.data || error.message);
  }
}

publishPost("posts/post1.html");
EOF