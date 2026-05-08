const express = require('express');
const multer = require('multer');
const fs = require('fs');
const https = require('https');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

app.post('/analyze', upload.single('report'), async (req, res) => {
  try {
    const PDFParser = require('pdf2json');
    const pdfParser = new PDFParser();

    const extractedText = await new Promise((resolve, reject) => {
      pdfParser.on('pdfParser_dataReady', (pdfData) => {
        const text = pdfData.Pages.map(page =>
          page.Texts.map(t => t.R.map(r => {
            try { return decodeURIComponent(r.T) }
            catch(e) { return r.T }
          }).join('')).join(' ')
        ).join('\n');
        resolve(text);
      });

      pdfParser.on('pdfParser_dataError', reject);
      pdfParser.loadPDF(req.file.path);
    });

    console.log('PDF read ho gaya!');
    console.log('Language selected:', req.body.lang);

    const selectedLang = req.body.lang || 'English';

    const postData = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You are a helpful medical assistant. You must reply in ${selectedLang} language only. Do not use any other language.`
        },
        {
          role: 'user',
          content: `Read this doctor report and explain in very simple ${selectedLang} language. Mention: 1) Main problem 2) Important values normal or not 3) What should patient do next. Report: ${extractedText}`
        }
      ]
    });

    const explanation = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req2 = https.request(options, (res2) => {
        let data = '';

        res2.on('data', (chunk) => {
          data += chunk;
        });

        res2.on('end', () => {
          try {
            const parsed = JSON.parse(data);

            console.log('Groq jawab mila!');

            if (parsed.error) {
              reject(new Error('Groq Error: ' + parsed.error.message));
            } else if (!parsed.choices || parsed.choices.length === 0) {
              reject(new Error('Koi response nahi: ' + JSON.stringify(parsed)));
            } else {
              resolve(parsed.choices[0].message.content);
            }

          } catch(e) {
            reject(new Error('Parse error: ' + e.message));
          }
        });
      });

      req2.on('error', reject);
      req2.write(postData);
      req2.end();
    });

    await supabase.from('reports').insert({
      file_name: req.file.originalname,
      language: selectedLang,
      result: explanation
    });

    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      explanation
    });

  } catch (error) {
    console.log('ERROR:', error.message);

    res.json({
      success: false,
      error: error.message
    });
  }
});

app.listen(3000, () => {
  console.log('✅ Server chal raha hai: http://localhost:3000');
});