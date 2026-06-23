import express from 'express';
import cors from 'cors';
import axios from 'axios';
import qs from 'qs';
import { EventEmitter } from 'events';

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Global session state for the survey generator
let sessionState = {
  id: null,
  status: 'idle', // 'idle', 'running', 'paused', 'stopped', 'completed'
  total: 0,
  completed: 0,
  successCount: 0,
  errorCount: 0,
  logs: [],
  statistics: {}, // { entryId: { optionName: count } }
  delayMin: 1000,
  delayMax: 3000,
  rules: {},
  formUrl: '',
  submitUrl: '',
  fbzxList: [], // Pool of fbzx tokens
  pagesCount: 1,
};

// Event emitter to communicate between worker loop and SSE endpoint
const progressEmitter = new EventEmitter();

// Common user agents to rotate
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Edge/120.0.0.0',
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
];

// Vietnamese Name Components for Mocking Submitter Names
const VN_FAMILY_NAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const VN_MIDDLE_MALE = ['Văn', 'Hữu', 'Đức', 'Minh', 'Xuân', 'Anh', 'Quốc', 'Thành', 'Hoàng', 'Gia', 'Ngọc', 'Trọng', 'Thế', 'Đăng'];
const VN_MIDDLE_FEMALE = ['Thị', 'Thanh', 'Hồng', 'Ngọc', 'Thảo', 'Phương', 'Bích', 'Như', 'Tuyết', 'Kim', 'Trang', 'Khánh', 'Minh'];
const VN_FIRST_MALE = ['Hùng', 'Cường', 'Dũng', 'Tuấn', 'Tú', 'Đạt', 'Kiệt', 'Hoàng', 'Minh', 'Phong', 'Sơn', 'Huy', 'Nam', 'Bình', 'Khánh', 'Lâm', 'Hải', 'Trung', 'Bách', 'Thành', 'Phúc', 'Lộc'];
const VN_FIRST_FEMALE = ['Hoa', 'Lan', 'Huệ', 'Trang', 'Phương', 'Linh', 'Thảo', 'Hương', 'Hà', 'Mai', 'Đào', 'Cúc', 'An', 'Bình', 'Như', 'Ngọc', 'Trinh', 'Anh', 'Oanh', 'Yến', 'Vy', 'Hân', 'Nhi', 'Trúc'];

function generateVietnameseName(gender = 'random') {
  const isMale = gender === 'Nam' || (gender === 'random' && Math.random() > 0.5);
  const family = VN_FAMILY_NAMES[Math.floor(Math.random() * VN_FAMILY_NAMES.length)];
  const middleList = isMale ? VN_MIDDLE_MALE : VN_MIDDLE_FEMALE;
  const middle = middleList[Math.floor(Math.random() * middleList.length)];
  const firstList = isMale ? VN_FIRST_MALE : VN_FIRST_FEMALE;
  const first = firstList[Math.floor(Math.random() * firstList.length)];
  
  // 10% chance of double middle name
  if (Math.random() > 0.9) {
    const extraMiddle = middleList[Math.floor(Math.random() * middleList.length)];
    if (extraMiddle !== middle) {
      return `${family} ${middle} ${extraMiddle} ${first}`;
    }
  }
  return `${family} ${middle} ${first}`;
}

// Simple Vietnamese feedback comments
const VN_FEEDBACKS = [
  'Khảo sát rất chi tiết và có ý nghĩa thực tiễn.',
  'Chúc nhóm nghiên cứu hoàn thành tốt đề tài nhé!',
  'Virtual Influencer là chủ đề khá mới mẻ và thú vị.',
  'Bảng hỏi thiết kế rõ ràng, dễ trả lời.',
  'Mình thấy rất ấn tượng với nghiên cứu này.',
  'Ý kiến cá nhân mình thấy người ảnh hưởng ảo rất có tiềm năng.',
  'Đã hoàn thành khảo sát, chúc nhóm đạt điểm cao.',
  'Đề tài nghiên cứu rất hay, hợp xu thế.',
  'Rất ủng hộ dự án này của các bạn.',
  'Chúc nhóm thu thập đủ mẫu khảo sát chất lượng.'
];

// Vietnamese name generator helper without accents for email
function removeVietnameseTones(str) {
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
  str = str.replace(/ù|á|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
  str = str.replace(/đ/g, "d");
  str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
  str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
  str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
  str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
  str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
  str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
  str = str.replace(/Đ/g, "D");
  str = str.replace(/\u0300|\u0301|\u0309|\u0303|\u0323/g, ""); // Huyen sac hoi nga nang
  str = str.replace(/\u02C6|\u0306|\u031B/g, ""); // Â, Ă, Ơ, Ư
  return str.toLowerCase().replace(/\s+/g, '');
}

// Generate a random realistic email based on gender
function generateRandomEmail(gender = 'random') {
  const name = generateVietnameseName(gender);
  const cleanName = removeVietnameseTones(name);
  const randNum = Math.floor(Math.random() * 900) + 100;
  const domains = ['gmail.com', 'outlook.com', 'yahoo.com', 'student.ueh.edu.vn', 'gmail.com'];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return `${cleanName}${randNum}@${domain}`;
}

// Generate realistic Vietnamese phone number
function generateVietnamesePhone() {
  const prefixes = ['090', '091', '098', '097', '096', '034', '035', '038', '039', '077', '078', '079', '081', '082', '085'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const body = Math.floor(1000000 + Math.random() * 9000000).toString().substring(0, 7);
  return `${prefix}${body}`;
}

// Generate realistic Student ID (MSSV) for UEH or common VN universities
function generateStudentId() {
  const prefix = '31';
  const yearCode = ['21', '22', '23', '24'][Math.floor(Math.random() * 4)];
  const majorCode = ['102', '201', '205', '502', '101'][Math.floor(Math.random() * 5)];
  const randBody = Math.floor(1000 + Math.random() * 9000).toString();
  return `${prefix}${yearCode}${majorCode}${randBody}`;
}

// Realistic reasons
const VN_REASONS = [
  'Do tò mò và muốn trải nghiệm thử công nghệ mới.',
  'Được bạn bè và đồng nghiệp giới thiệu nên muốn tìm hiểu.',
  'Thấy thông tin quảng cáo trên Facebook/Tiktok khá thú vị.',
  'Muốn tìm hiểu thêm về xu hướng người ảnh hưởng ảo (Virtual Influencer).',
  'Phục vụ cho nhu cầu học tập, nghiên cứu khoa học của bản thân.',
  'Tôi cảm thấy chủ đề này khá mới mẻ và có tiềm năng phát triển.',
  'Do quan tâm đến lĩnh vực du lịch và tiếp thị số.',
  'Muốn so sánh người ảnh hưởng ảo với người thật xem thế nào.',
  'Thấy mọi người thảo luận nhiều trên mạng xã hội nên tò mò.',
  'Do thích khám phá các nội dung du lịch độc đáo.'
];

// General short text answers
const VN_GENERAL_ANSWERS = [
  'Không có ý kiến gì thêm.',
  'Mọi thứ đều khá tốt và đầy đủ.',
  'Rất hài lòng với cuộc khảo sát này.',
  'Mong nghiên cứu của nhóm thành công tốt đẹp.',
  'Không có gì.',
  'Bình thường.',
  'Mình thấy ổn.',
  'Khảo sát xây dựng rất tốt.',
  'Chúc nhóm đạt kết quả cao.'
];

// Dynamic generator depending on rule/question properties
function generateSmartText(title = '', ruleMode = 'random', gender = 'random') {
  const titleLower = title.toLowerCase();
  
  if (ruleMode === 'text_name' || (ruleMode === 'random' && (titleLower.includes('họ tên') || titleLower.includes('họ và tên') || titleLower.includes('tên của bạn') || titleLower.includes('tên anh/chị') || titleLower.includes('fullname') || titleLower.includes('tên bạn')))) {
    return generateVietnameseName(gender);
  }
  
  if (ruleMode === 'text_email' || (ruleMode === 'random' && (titleLower.includes('email') || titleLower.includes('thư điện tử') || titleLower.includes('gmail')))) {
    return generateRandomEmail(gender);
  }
  
  if (ruleMode === 'text_phone' || (ruleMode === 'random' && (titleLower.includes('sđt') || titleLower.includes('số điện thoại') || titleLower.includes('điện thoại') || titleLower.includes('phone') || titleLower.includes('liên hệ')))) {
    return generateVietnamesePhone();
  }
  
  if (ruleMode === 'text_mssv' || (ruleMode === 'random' && (titleLower.includes('mssv') || titleLower.includes('mã số sinh viên') || titleLower.includes('mã sinh viên') || titleLower.includes('student id')))) {
    return generateStudentId();
  }
  
  if (ruleMode === 'text_reason' || (ruleMode === 'random' && (titleLower.includes('lý do') || titleLower.includes('vì sao') || titleLower.includes('tại sao') || titleLower.includes('reason')))) {
    return VN_REASONS[Math.floor(Math.random() * VN_REASONS.length)];
  }
  
  if (ruleMode === 'text_feedback' || (ruleMode === 'random' && (titleLower.includes('góp ý') || titleLower.includes('nhận xét') || titleLower.includes('ý kiến') || titleLower.includes('phản hồi') || titleLower.includes('góp ý khác') || titleLower.includes('feedback') || titleLower.includes('comment')))) {
    return VN_FEEDBACKS[Math.floor(Math.random() * VN_FEEDBACKS.length)];
  }

  // General fallback
  return VN_GENERAL_ANSWERS[Math.floor(Math.random() * VN_GENERAL_ANSWERS.length)];
}

// Helper to select an option using probability weights
function selectWeightedOption(options, weights) {
  if (!options || options.length === 0) return '';
  
  // Filter weights to match options, default to equal weight if not set
  const optionWeights = options.map(opt => {
    return (weights && typeof weights[opt] === 'number') ? weights[opt] : 100 / options.length;
  });
  
  const totalWeight = optionWeights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) {
    return options[Math.floor(Math.random() * options.length)];
  }
  
  let randomVal = Math.random() * totalWeight;
  for (let i = 0; i < options.length; i++) {
    randomVal -= optionWeights[i];
    if (randomVal <= 0) {
      return options[i];
    }
  }
  return options[options.length - 1];
}

// ----------------------------------------------------
// Parse Endpoint
// ----------------------------------------------------
app.get('/api/parse', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    // Clean and normalize Google Form URL
    let viewFormUrl = url.trim();
    if (viewFormUrl.endsWith('/formResponse')) {
      viewFormUrl = viewFormUrl.replace('/formResponse', '/viewform');
    }
    if (!viewFormUrl.includes('/viewform') && !viewFormUrl.includes('/formResponse')) {
      // Append viewform if not present
      if (viewFormUrl.endsWith('/')) {
        viewFormUrl += 'viewform';
      } else if (!viewFormUrl.includes('/d/e/')) {
        return res.status(400).json({ error: 'Invalid Google Form URL format' });
      } else {
        viewFormUrl = viewFormUrl.split('?')[0] + '/viewform';
      }
    }

    const response = await axios.get(viewFormUrl, {
      headers: {
        'User-Agent': USER_AGENTS[0]
      }
    });

    const html = response.data;
    
    // Extract fbzx token
    const fbzxMatch = html.match(/name="fbzx"\s+value="([^"]+)"/);
    const fbzx = fbzxMatch ? fbzxMatch[1] : null;

    // Find FB_PUBLIC_LOAD_DATA_ script block
    const marker = 'var FB_PUBLIC_LOAD_DATA_ = ';
    const startIndex = html.indexOf(marker);
    if (startIndex === -1) {
      return res.status(404).json({ error: 'Could not find FB_PUBLIC_LOAD_DATA_ in form HTML. Is it a public Google Form?' });
    }

    const startOfData = startIndex + marker.length;
    const endScriptIndex = html.indexOf('</script>', startOfData);
    if (endScriptIndex === -1) {
      return res.status(500).json({ error: 'Malformed form HTML: closing script tag not found' });
    }

    let dataStr = html.substring(startOfData, endScriptIndex).trim();
    if (dataStr.endsWith(';')) {
      dataStr = dataStr.slice(0, -1);
    }

    // Safely evaluate data string
    // FB_PUBLIC_LOAD_DATA_ is a nested array.
    // Instead of insecure eval, we can try parsing it using JSON.
    // If it's valid JS literal but not strict JSON (e.g. contains undefined or unquoted properties),
    // we can parse it by simulating a Node module run or safe eval. Since it's a local trusted tool,
    // we can use a Function constructor wrapper to parse it.
    let formArray;
    try {
      formArray = new Function(`return ${dataStr}`)();
    } catch (e) {
      return res.status(500).json({ error: `Failed to parse form metadata array: ${e.message}` });
    }

    const formInfo = formArray[1];
    const formTitle = formInfo[8] || formInfo[0] || 'Google Form';
    const formDescription = formInfo[1] || '';
    const rawQuestions = formInfo[1] || [];

    // Parse the submit URL
    const formIdMatch = viewFormUrl.match(/\/d\/e\/([^/]+)/);
    if (!formIdMatch) {
      return res.status(400).json({ error: 'Could not extract Form ID from URL' });
    }
    const formId = formIdMatch[1];
    const submitUrl = `https://docs.google.com/forms/d/e/${formId}/formResponse`;

    const parsedQuestions = [];
    let sectionCount = 1; // Start with at least 1 section

    rawQuestions.forEach((q, index) => {
      const qId = q[0];
      const qTitle = q[1];
      const qDesc = q[2];
      const qType = q[3];

      // Track sections / page breaks (Type 8 represents section break, Type 6 is just text info block)
      if (qType === 8) {
        sectionCount++;
        parsedQuestions.push({
          id: qId,
          title: qTitle || `Section ${sectionCount}`,
          description: qDesc,
          type: 'section',
          isInput: false
        });
        return;
      }

      if (qType === 6) {
        // Description block (no input)
        parsedQuestions.push({
          id: qId,
          title: qTitle || 'Information Block',
          description: qDesc,
          type: 'info',
          isInput: false
        });
        return;
      }

      // Input questions have sub-items in q[4]
      if (q[4] && q[4].length > 0) {
        // Linear scale (Type 5), Multi-choice (Type 2), Checkbox (Type 4), Dropdown (Type 3), Short Text (Type 0), Long Text (Type 1)
        
        // Handle Grid layout (Type 7) which has multiple sub-items, each corresponding to a row
        if (qType === 7) {
          // Multiple Choice Grid / Checkbox Grid
          const rows = q[4].map(rowSub => ({
            entryId: rowSub[0],
            rowTitle: rowSub[3] || rowSub[1] || '',
          }));
          
          // Columns are usually in rowSub[1] options of row 0
          const cols = q[4][0][1] ? q[4][0][1].map(col => col[0]) : [];
          
          parsedQuestions.push({
            id: qId,
            title: qTitle,
            description: qDesc,
            type: 'grid',
            isInput: true,
            required: q[4][0][2] === 1 || q[4][0][2] === true,
            rows: rows,
            columns: cols
          });
          return;
        }

        // Standard questions
        const sub = q[4][0];
        const entryId = sub[0];
        const required = sub[2] === 1 || sub[2] === true;
        let options = [];

        if (sub[1]) {
          options = sub[1].map(opt => {
            // Empty string option stands for "Other" choice
            return opt[0] === '' ? 'Other (Tùy chọn khác)' : opt[0];
          });
        }

        let typeStr = 'text';
        if (qType === 0) typeStr = 'short_text';
        else if (qType === 1) typeStr = 'long_text';
        else if (qType === 2) typeStr = 'multiple_choice';
        else if (qType === 3) typeStr = 'dropdown';
        else if (qType === 4) typeStr = 'checkbox';
        else if (qType === 5) {
          typeStr = 'linear_scale';
          // Linear scales store scale labels in sub[3] (e.g. ['Hoàn toàn không đồng ý', 'Hoàn toàn đồng ý'])
          const minLabel = (sub[3] && sub[3][0]) || '';
          const maxLabel = (sub[3] && sub[3][1]) || '';
          // Build scale options (e.g. 1 to 5 or 1 to 7)
          options = sub[1].map(opt => opt[0]);
          parsedQuestions.push({
            id: qId,
            entryId: entryId,
            title: qTitle,
            description: qDesc,
            type: typeStr,
            isInput: true,
            required,
            options,
            scaleLabels: { min: minLabel, max: maxLabel }
          });
          return;
        }

        parsedQuestions.push({
          id: qId,
          entryId: entryId,
          title: qTitle,
          description: qDesc,
          type: typeStr,
          isInput: true,
          required,
          options
        });
      }
    });

    res.json({
      title: formTitle,
      description: formDescription,
      submitUrl: submitUrl,
      fbzx: fbzx,
      questions: parsedQuestions,
      pagesCount: sectionCount
    });

  } catch (err) {
    res.status(500).json({ error: `Error parsing Google Form: ${err.message}` });
  }
});

// ----------------------------------------------------
// SSE Progress Stream
// ----------------------------------------------------
app.get('/api/session-progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Send current state on connection
  res.write(`data: ${JSON.stringify({ type: 'init', state: { ...sessionState, client: undefined } })}\n\n`);

  const onProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  progressEmitter.on('update', onProgress);

  req.on('close', () => {
    progressEmitter.removeListener('update', onProgress);
  });
});

// Helper to broadcast state changes
function broadcastUpdate(type = 'progress', message = '') {
  // Strip functions or circular dependencies
  const safeState = {
    id: sessionState.id,
    status: sessionState.status,
    total: sessionState.total,
    completed: sessionState.completed,
    successCount: sessionState.successCount,
    errorCount: sessionState.errorCount,
    statistics: sessionState.statistics,
    delayMin: sessionState.delayMin,
    delayMax: sessionState.delayMax,
    formUrl: sessionState.formUrl,
    submitUrl: sessionState.submitUrl,
  };
  progressEmitter.emit('update', { type, state: safeState, message, logs: sessionState.logs });
}

// ----------------------------------------------------
// Start Generation Session
// ----------------------------------------------------
let workerIntervalId = null;

app.post('/api/start-session', async (req, res) => {
  const { formUrl, submitUrl, rules, totalCount, delayMin, delayMax } = req.body;

  if (!submitUrl) {
    return res.status(400).json({ error: 'submitUrl is required' });
  }

  // If there's an existing session running, stop it
  if (sessionState.status === 'running') {
    sessionState.status = 'stopped';
    if (workerIntervalId) {
      clearTimeout(workerIntervalId);
      workerIntervalId = null;
    }
  }

  // Reset session state
  sessionState = {
    id: Date.now().toString(),
    status: 'running',
    total: parseInt(totalCount) || 10,
    completed: 0,
    successCount: 0,
    errorCount: 0,
    logs: [],
    statistics: {},
    delayMin: parseInt(delayMin) || 1000,
    delayMax: parseInt(delayMax) || 3000,
    rules: rules || {},
    formUrl: formUrl || '',
    submitUrl: submitUrl,
    fbzxList: [],
    pagesCount: req.body.pagesCount || 7,
  };

  // Initialize stats counters
  Object.keys(sessionState.rules).forEach(entryId => {
    sessionState.statistics[entryId] = {};
  });

  const timestamp = new Date().toLocaleTimeString();
  sessionState.logs.unshift({
    timestamp,
    type: 'info',
    text: `Bắt đầu phiên chạy mới (#${sessionState.id}). Mục tiêu: ${sessionState.total} lượt khảo sát.`
  });

  res.json({ success: true, sessionId: sessionState.id });
  broadcastUpdate('status', 'Bắt đầu khởi chạy...');

  // Start background worker loop
  runWorkerLoop();
});

// ----------------------------------------------------
// Worker Logic
// ----------------------------------------------------
async function runWorkerLoop() {
  if (sessionState.status !== 'running') return;
  
  if (sessionState.completed >= sessionState.total) {
    sessionState.status = 'completed';
    const timestamp = new Date().toLocaleTimeString();
    sessionState.logs.unshift({
      timestamp,
      type: 'success',
      text: `Hoàn thành! Đã tạo thành công ${sessionState.successCount}/${sessionState.total} khảo sát.`
    });
    broadcastUpdate('completed', 'Tất cả khảo sát đã được hoàn tất!');
    return;
  }

  const currentIndex = sessionState.completed + 1;
  const timestamp = new Date().toLocaleTimeString();
  sessionState.logs.unshift({
    timestamp,
    type: 'info',
    text: `Đang chuẩn bị gửi khảo sát #${currentIndex}...`
  });
  broadcastUpdate('progress', `Đang chuẩn bị gửi khảo sát #${currentIndex}...`);

  try {
    // 1. Fetch fresh fbzx token from form page to mimic real browser behavior
    let fbzx = null;
    try {
      const formPageResponse = await axios.get(sessionState.formUrl || sessionState.submitUrl.replace('/formResponse', '/viewform'), {
        headers: {
          'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
        },
        timeout: 5000
      });
      const html = formPageResponse.data;
      const fbzxMatch = html.match(/name="fbzx"\s+value="([^"]+)"/);
      if (fbzxMatch) fbzx = fbzxMatch[1];
    } catch (err) {
      console.warn('Could not fetch fresh fbzx, falling back to static generation', err.message);
    }

    if (!fbzx) {
      fbzx = Date.now().toString(); // Fallback token
    }

    // 2. Generate payload based on rules
    const payload = {};
    const submitInfoSummary = [];
    
    // Track Gender for realistic name generation
    let genderVal = 'random';
    
    // Find gender rule if set
    Object.keys(sessionState.rules).forEach(entryId => {
      const rule = sessionState.rules[entryId];
      if (rule.type === 'gender') {
        // If it is custom weights, pick a weighted value first to help with name generation
        if (rule.mode === 'weights') {
          genderVal = selectWeightedOption(rule.options, rule.weights);
        } else if (rule.mode === 'fixed') {
          genderVal = rule.fixedValue;
        } else {
          genderVal = rule.options[Math.floor(Math.random() * rule.options.length)];
        }
      }
    });

    Object.keys(sessionState.rules).forEach(entryId => {
      const rule = sessionState.rules[entryId];
      let value = '';

      if (rule.type === 'grid') {
        // Grid contains multiple rows, each row has a separate entryId
        rule.rows.forEach(row => {
          let rowValue = '';
          if (rule.mode === 'weights') {
            rowValue = selectWeightedOption(rule.columns, rule.weights);
          } else if (rule.mode === 'fixed') {
            rowValue = rule.fixedValue;
          } else {
            rowValue = rule.columns[Math.floor(Math.random() * rule.columns.length)];
          }
          payload[`entry.${row.entryId}`] = rowValue;
          
          // Update stats
          if (!sessionState.statistics[entryId]) sessionState.statistics[entryId] = {};
          if (!sessionState.statistics[entryId][row.rowTitle]) sessionState.statistics[entryId][row.rowTitle] = {};
          sessionState.statistics[entryId][row.rowTitle][rowValue] = (sessionState.statistics[entryId][row.rowTitle][rowValue] || 0) + 1;
        });
        return;
      }

      if (rule.mode === 'fixed') {
        value = rule.fixedValue;
      } else if (rule.mode === 'custom_list') {
        const lines = (rule.customListText || '').split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          value = lines[Math.floor(Math.random() * lines.length)];
        } else {
          value = generateSmartText(rule.title, 'random', genderVal);
        }
      } else if (rule.mode === 'weights') {
        value = selectWeightedOption(rule.options, rule.weights);
      } else if (rule.mode === 'text_name') {
        value = generateVietnameseName(genderVal);
      } else if (rule.mode === 'text_email') {
        value = generateRandomEmail(genderVal);
      } else if (rule.mode === 'text_phone') {
        value = generateVietnamesePhone();
      } else if (rule.mode === 'text_mssv') {
        value = generateStudentId();
      } else if (rule.mode === 'text_reason') {
        value = VN_REASONS[Math.floor(Math.random() * VN_REASONS.length)];
      } else if (rule.mode === 'text_feedback') {
        value = VN_FEEDBACKS[Math.floor(Math.random() * VN_FEEDBACKS.length)];
      } else if (rule.mode === 'text_general') {
        value = VN_GENERAL_ANSWERS[Math.floor(Math.random() * VN_GENERAL_ANSWERS.length)];
      } else if (rule.mode === 'checkbox_random') {
        // Checkboxes can select multiple options
        const minSelect = parseInt(rule.minChecked) || 1;
        const maxSelect = parseInt(rule.maxChecked) || Math.max(1, rule.options.length);
        
        // Randomly pick a number of choices to select
        const countToSelect = Math.floor(Math.random() * (maxSelect - minSelect + 1)) + minSelect;
        
        // Sort options randomly or by weight and slice
        const shuffled = [...rule.options];
        shuffled.sort(() => 0.5 - Math.random());
        value = shuffled.slice(0, countToSelect);
      } else {
        // Default random
        if (rule.options && rule.options.length > 0) {
          value = rule.options[Math.floor(Math.random() * rule.options.length)];
        } else {
          value = generateSmartText(rule.title, 'random', genderVal);
        }
      }

      // Handle standard inputs
      if (Array.isArray(value)) {
        // For checkboxes
        payload[`entry.${entryId}`] = value;
        value.forEach(v => {
          sessionState.statistics[entryId][v] = (sessionState.statistics[entryId][v] || 0) + 1;
        });
        submitInfoSummary.push(`${rule.title.substring(0, 15)}...: [${value.join(', ')}]`);
      } else {
        payload[`entry.${entryId}`] = value;
        if (rule.options && rule.options.length > 0) {
          sessionState.statistics[entryId][value] = (sessionState.statistics[entryId][value] || 0) + 1;
        }
        submitInfoSummary.push(`${rule.title.substring(0, 15)}...: "${value}"`);
      }
    });

    // 3. Construct form control fields
    payload['fvv'] = '1';
    payload['draftResponse'] = JSON.stringify([null, null, fbzx]);
    payload['fbzx'] = fbzx;
    
    // Construct page history: '0,1,2,3,4,5,6' based on pagesCount
    const historyArr = [];
    for (let i = 0; i < sessionState.pagesCount; i++) {
      historyArr.push(i);
    }
    payload['pageHistory'] = historyArr.join(',');

    // 4. Send POST request
    const postData = qs.stringify(payload, { arrayFormat: 'repeat' });
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    
    const postResponse = await axios.post(sessionState.submitUrl, postData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent
      },
      timeout: 10000
    });

    const responseHtml = postResponse.data;
    
    // Check for success markers
    const isSuccess = responseHtml.includes('đã được ghi lại') || 
                      responseHtml.includes('response has been recorded') || 
                      responseHtml.includes('freebirdFormviewResponseConfirmationMessage') ||
                      postResponse.status === 200;

    if (isSuccess) {
      sessionState.successCount++;
      sessionState.logs.unshift({
        timestamp: new Date().toLocaleTimeString(),
        type: 'success',
        text: `Khảo sát #${currentIndex} thành công. Payload: ${submitInfoSummary.slice(0, 3).join(' | ')}...`
      });
    } else {
      sessionState.errorCount++;
      sessionState.logs.unshift({
        timestamp: new Date().toLocaleTimeString(),
        type: 'error',
        text: `Khảo sát #${currentIndex} lỗi: Google Forms từ chối phản hồi (Có thể do thiết lập Captcha).`
      });
    }

  } catch (err) {
    sessionState.errorCount++;
    sessionState.logs.unshift({
      timestamp: new Date().toLocaleTimeString(),
      type: 'error',
      text: `Khảo sát #${currentIndex} lỗi: ${err.message}`
    });
  }

  sessionState.completed++;
  broadcastUpdate('progress', `Đã cập nhật tiến độ #${currentIndex}`);

  // Schedule next iteration with random delay
  const randomDelay = Math.floor(Math.random() * (sessionState.delayMax - sessionState.delayMin + 1)) + sessionState.delayMin;
  workerIntervalId = setTimeout(runWorkerLoop, randomDelay);
}

// ----------------------------------------------------
// Pause / Stop Controls
// ----------------------------------------------------
app.post('/api/pause-session', (req, res) => {
  if (sessionState.status === 'running') {
    sessionState.status = 'paused';
    if (workerIntervalId) {
      clearTimeout(workerIntervalId);
      workerIntervalId = null;
    }
    const timestamp = new Date().toLocaleTimeString();
    sessionState.logs.unshift({
      timestamp,
      type: 'info',
      text: 'Đã tạm dừng phiên chạy.'
    });
    broadcastUpdate('status', 'Tạm dừng.');
    return res.json({ success: true, status: 'paused' });
  }
  res.status(400).json({ error: 'Session is not running' });
});

app.post('/api/resume-session', (req, res) => {
  if (sessionState.status === 'paused') {
    sessionState.status = 'running';
    const timestamp = new Date().toLocaleTimeString();
    sessionState.logs.unshift({
      timestamp,
      type: 'info',
      text: 'Tiếp tục phiên chạy.'
    });
    broadcastUpdate('status', 'Đang chạy lại...');
    runWorkerLoop();
    return res.json({ success: true, status: 'running' });
  }
  res.status(400).json({ error: 'Session is not paused' });
});

app.post('/api/stop-session', (req, res) => {
  sessionState.status = 'stopped';
  if (workerIntervalId) {
    clearTimeout(workerIntervalId);
    workerIntervalId = null;
  }
  const timestamp = new Date().toLocaleTimeString();
  sessionState.logs.unshift({
    timestamp,
    type: 'warning',
    text: 'Đã hủy phiên chạy.'
  });
  broadcastUpdate('status', 'Đã dừng.');
  res.json({ success: true, status: 'stopped' });
});

app.get('/api/session-status', (req, res) => {
  res.json({
    id: sessionState.id,
    status: sessionState.status,
    total: sessionState.total,
    completed: sessionState.completed,
    successCount: sessionState.successCount,
    errorCount: sessionState.errorCount,
    statistics: sessionState.statistics,
    formUrl: sessionState.formUrl,
    submitUrl: sessionState.submitUrl,
    logs: sessionState.logs
  });
});

app.listen(port, () => {
  console.log(`Express server running on http://localhost:${port}`);
});
