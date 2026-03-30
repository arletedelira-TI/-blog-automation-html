const fs = require('fs');
const axios = require('axios');


const BLOG_ID = process.env.BLOG_ID;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.BLOGGER_REFRESH_TOKEN;


async function getAccessToken() {
  const response = await axios.post(
    'https://oauth2.googleapis.com/token',
    {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token'
    }
  );
  return response.data.access_token;
}


async function publishPost(filePath) {
  try {
    const TOKEN = await getAccessToken();
    const content = fs.readFileSync(filePath, 'utf-8');
    const title = filePath.split('/').pop().replace('.html', '');


    const response = await axios.post(
      `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`,
      { kind: 'blogger#post', title: title, content: content },
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );


    console.log('Publicado:', response.data.url);
  } catch (error) {
    console.error('Erro:', error.response?.data || error.message);
  }
}


publishPost('posts/novo-post.html');
