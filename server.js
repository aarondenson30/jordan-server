const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const SLACK_TOKEN = process.env.SLACK_TOKEN;
const MATON_KEY = process.env.MATON_KEY;
const JORDAN_CONN = process.env.JORDAN_CONN;
const OPENAI_KEY = process.env.OPENAI_KEY;
const PORT = process.env.PORT || 3456;

// Load scopes
let SCOPES = {};
try {
  SCOPES = JSON.parse(fs.readFileSync(path.join(__dirname, 'scopes.json'), 'utf8'));
} catch(e) {
  console.log('No scopes.json found');
}

function getScope(trade) {
  const tradeLower = trade.toLowerCase();
  // Try exact match first
  for (const [key, val] of Object.entries(SCOPES)) {
    if (tradeLower === key) return val;
  }
  // Try partial match
  for (const [key, val] of Object.entries(SCOPES)) {
    if (tradeLower.includes(key) || key.includes(tradeLower)) return val;
  }
  return null;
}

const SUBS = [
  { name: 'aloha', email: 'Alohaflooringtx@gmail.com', contact: 'Micah Bacon', company: 'Aloha Premier Tile & Flooring' },
  { name: 'abella', email: 'abellasweldingtx@gmail.com', contact: 'Fernando Abella', company: "Abella's Welding" },
  { name: 'anaya', email: 'ignacioanaya819@gmail.com', contact: 'Ignacio Anaya', company: 'Anaya Stone' },
  { name: 'big daddy', email: 'jessica@ExactaBTS.com', contact: 'Jessica Rosales', company: 'Big Daddy Construction' },
  { name: 'lj framing', email: 'ljframing.llc@gmail.com', contact: 'Jesus Fernandez', company: 'LJ Framing' },
  { name: 'oscar resendiz', email: 'jennyresendiznolasco@gmail.com', contact: 'Jenny Resendiz', company: 'Oscar Resendiz Drywall' },
  { name: 'master panda', email: 'masterpandapainting@gmail.com', contact: 'Wilmer Zambrano', company: 'Master Panda Painting' },
  { name: 'torres', email: 'rubiceltorres02@gmail.com', contact: 'Rubicel Torres', company: 'Torres Custom Cabinets' },
  { name: 'cuellar', email: 'vccuellarwelding@gmail.com', contact: 'Valentin Cuellar', company: 'VC Cuellar Welding' },
  { name: 'linda vista', email: 'lindavistalandscaping@gmail.com', contact: 'Felipe Rivera', company: 'Linda Vista Landscaping' },
  { name: 'david valle', email: 'davidvalleconcrete@gmail.com', contact: 'David Valle', company: 'David Valle Concrete' },
  { name: 'ff construction', email: 'f.fconstructionllc1@gmail.com', contact: 'Juan Flores', company: 'FF Construction' },
  { name: 'oag', email: 'mrios@service-partners.com', contact: '', company: 'OAG Loyalty Insulation' },
  { name: 'builder supply', email: 'fabrizio@buildersupplygroup.com', contact: 'Fabrizio Palermo', company: 'Builder Supply Group' }
];

function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function findSub(subName) {
  const searchLower = normalize(subName);
  // Exact match first
  let found = SUBS.find(s => searchLower === normalize(s.name));
  if (found) return found;
  // Partial match with normalization
  found = SUBS.find(s => {
    const normName = normalize(s.company);
    const normKey = normalize(s.name);
    return searchLower.includes(normKey) || normKey.includes(searchLower) || normName.includes(searchLower);
  });
  return found;
}

function post(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function slackPost(channel, text) {
  console.log('Slack ->', channel, ':', text.substring(0, 80));
  return post('slack.com', '/api/chat.postMessage',
    { Authorization: 'Bearer ' + SLACK_TOKEN },
    { channel, text }
  );
}

async function sendBidEmail(trade, job, subEmail, subContact, subCompany) {
  console.log('Sending bid email to', subEmail, 'for', trade, 'at', job);
  
  const scope = getScope(trade);
  const scopeSection = scope 
    ? '\n\nSCOPE OF WORK:\n' + scope
    : '';

  return post('gateway.maton.ai', '/outlook/v1.0/me/sendMail',
    { Authorization: 'Bearer ' + MATON_KEY, 'Maton-Connection': JORDAN_CONN },
    {
      message: {
        subject: 'Bid Request - ' + trade + ' - ' + job,
        body: {
          contentType: 'Text',
          content: [
            'Hi ' + (subContact || subCompany) + ',',
            '',
            'We are requesting a bid for the following scope of work:',
            '',
            'Trade: ' + trade,
            'Job Address: ' + job,
            scopeSection,
            '',
            'Please provide your bid at your earliest convenience.',
            '',
            'Thank you,',
            'Jordan Riviera',
            'Project Manager | Longhorn Contractor Services',
            'jordan@longhorncsteam.com',
            '(512) 555-0100'
          ].join('\n')
        },
        toRecipients: [{ emailAddress: { address: subEmail } }],
        ccRecipients: [
          { emailAddress: { address: 'aaron@longhorncsteam.com' } },
          { emailAddress: { address: 'bobby@longhorncsteam.com' } },
          { emailAddress: { address: 'brittney@longhorncsteam.com' } },
          { emailAddress: { address: 'said@longhorncsteam.com' } },
          { emailAddress: { address: 'leslie@longhorncsteam.com' } }
        ]
      },
      saveToSentItems: true
    }
  );
}

async function handleMessage(text, channel) {
  const isBid = text.toLowerCase().includes('bid request');

  if (isBid) {
    const parts = text.split('|').map(p => p.trim());
    const trade = parts[1] || 'General';
    const subName = parts[2] || '';
    const job = parts[3] || 'Job TBD';

    const found = findSub(subName);

    if (!found) {
      await slackPost(channel, '⚠️ Sub not found: "' + subName + '". Check the name and try again.');
      return;
    }

    await sendBidEmail(trade, job, found.email, found.contact, found.company);
    await slackPost(channel, '✅ Bid sent to ' + found.company + ' for ' + trade + ' at ' + job + '. Scope included. Team CC\'d on Longhorn emails.');

  } else {
    const ai = await post('api.openai.com', '/v1/chat/completions',
      { Authorization: 'Bearer ' + OPENAI_KEY },
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are Jordan Riviera, Project Manager for Numinous Homes and Longhorn Contractor Services. Professional and brief. 1-2 sentences only.' },
          { role: 'user', content: text }
        ]
      }
    );
    const reply = ai.choices && ai.choices[0] ? ai.choices[0].message.content : 'On it.';
    await slackPost(channel, reply);
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200);
    res.end('Jordan Server Running');
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);

      if (data.type === 'url_verification') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ challenge: data.challenge }));
        return;
      }

      res.writeHead(200);
      res.end('ok');

      const event = data.event || {};
      const text = (event.text || '').trim();
      const channel = event.channel || '';
      const botId = event.bot_id || '';
      const subtype = event.subtype || '';

      if (!botId && !subtype && text && channel) {
        await handleMessage(text, channel);
      }

    } catch (err) {
      console.error('Error:', err.message);
      res.writeHead(200);
      res.end('ok');
    }
  });
});

server.listen(PORT, () => {
  console.log('Jordan server running on port ' + PORT);
});
