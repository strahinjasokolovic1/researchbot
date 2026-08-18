import React, { useState } from 'react';
import axios from 'axios';

function App() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  const askAI = async () => {
    setLoading(true);
    try {
      const res = await axios.post('http://localhost:5000/ask', { question });
      setAnswer(res.data.answer);
    } catch (e) {
      setAnswer("Došlo je do greške.");
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: 'auto', fontFamily: 'Arial' }}>
      <h1>Naučni Chat Bot 🤖</h1>
      <textarea 
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Pitaj me bilo šta iz nauke..."
        style={{ width: '100%', height: '100px', padding: '10px', borderRadius: '8px' }}
      />
      <button 
        onClick={askAI} 
        disabled={loading}
        style={{ marginTop: '10px', padding: '10px 20px', cursor: 'pointer' }}
      >
        {loading ? "Pretražujem bazu i pišem odgovor..." : "Pitaj"}
      </button>

      {answer && (
        <div style={{ marginTop: '30px', padding: '20px', backgroundColor: '#000000', borderRadius: '8px', whiteSpace: 'pre-wrap' }}>
          <strong>Odgovor:</strong>
          <p>{answer}</p>
        </div>
      )}
    </div>
  );
}

export default App;