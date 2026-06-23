import axios from 'axios';

const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSckYUDbyreLwZxOvwC-eQ5DRsqL7M5OtnfeByKmBkxi6ApN0g/viewform';

async function main() {
  try {
    console.log('Step 1: Parsing form via API...');
    const parseRes = await axios.get(`http://localhost:5000/api/parse?url=${encodeURIComponent(formUrl)}`);
    const formMeta = parseRes.data;
    
    console.log('Successfully parsed form!');
    console.log('Title:', formMeta.title);
    console.log('Number of questions:', formMeta.questions.length);
    console.log('Pages Count:', formMeta.pagesCount);

    console.log('\nStep 2: Preparing rules...');
    const rules = {};
    formMeta.questions.forEach(q => {
      if (!q.isInput) return;
      
      const titleLower = q.title.toLowerCase();
      let mode = 'random';
      let fixedValue = '';
      
      // Auto-detect Vietnamese name fields
      if (titleLower.includes('tên của bạn') || titleLower.includes('họ và tên') || titleLower.includes('họ tên')) {
        mode = 'text_name';
      }
      // Auto-detect Vietnamese feedbacks
      else if (titleLower.includes('góp ý') || titleLower.includes('nhận xét') || titleLower.includes('ý kiến') || titleLower.includes('phản hồi')) {
        mode = 'text_feedback';
      }
      // Attention checks
      else if (titleLower.includes('lớn nhất')) {
        mode = 'fixed';
        fixedValue = '7';
      } else if (titleLower.includes('nhỏ nhất')) {
        mode = 'fixed';
        fixedValue = '1';
      }

      const weights = {};
      if (q.options && q.options.length > 0) {
        // Just use default equal weights
        const equalPct = Math.round(100 / q.options.length);
        q.options.forEach(opt => {
          weights[opt] = equalPct;
        });
      }

      if (q.type === 'grid') {
        rules[q.id] = {
          title: q.title,
          type: q.type,
          mode: 'random',
          rows: q.rows,
          columns: q.columns,
          fixedValue: q.columns[0] || '',
          weights: q.columns.reduce((acc, col) => {
            acc[col] = Math.round(100 / q.columns.length);
            return acc;
          }, {})
        };
      } else {
        rules[q.entryId] = {
          title: q.title,
          type: q.type,
          mode: mode,
          options: q.options || [],
          weights: weights,
          fixedValue: fixedValue || (q.options && q.options[0]) || '',
          minChecked: 1,
          maxChecked: q.options ? Math.min(2, q.options.length) : 1
        };
      }
    });

    console.log('\nStep 3: Launching submission session...');
    const startRes = await axios.post('http://localhost:5000/api/start-session', {
      formUrl: formUrl,
      submitUrl: formMeta.submitUrl,
      rules: rules,
      totalCount: 5,
      delayMin: 1000,
      delayMax: 2000,
      pagesCount: formMeta.pagesCount
    });

    if (startRes.data.success) {
      console.log('Session started successfully! Session ID:', startRes.data.sessionId);
    } else {
      console.error('Failed to start session:', startRes.data.error);
      return;
    }

    console.log('\nStep 4: Polling status until completion...');
    let completed = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      // Wait 3 seconds between checks
      await new Promise(r => setTimeout(r, 3000));
      
      const statusRes = await axios.get('http://localhost:5000/api/session-status');
      const state = statusRes.data;
      
      console.log(`Progress: ${state.completed}/${state.total} | Success: ${state.successCount} | Error: ${state.errorCount} | Status: ${state.status}`);
      
      if (state.logs && state.logs.length > 0) {
        console.log('Latest Log:', state.logs[0].text);
      }

      if (state.status === 'completed' || state.status === 'stopped') {
        completed = true;
        console.log('\nSession finished!');
        console.log('Final Statistics of submitted options for a demographic field (Giới tính của anh/chị?):');
        // entryId of gender is 572754396
        const genderStats = state.statistics['572754396'];
        console.log(genderStats ? JSON.stringify(genderStats, null, 2) : 'No gender stats recorded');
        break;
      }
    }

    if (!completed) {
      console.log('Test timed out before completion.');
    }
  } catch (error) {
    console.error('Error during integration test:', error.message);
  }
}

main();
