import { useState } from 'react';
import axios from 'axios';
import './App.css';

const API_URL = 'http://localhost:5000';

function PaperCard({ paper, onChat }) {
  const [flipped, setFlipped] = useState(false);
  const textToCopy = flipped ? paper.translation : paper.original;

  const copyText = async (event) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(textToCopy || '');
  };

  return (
    <article className={`paper-card ${flipped ? 'is-flipped' : ''}`} onClick={() => setFlipped(!flipped)}>
      <div className="card-inner">
        <div className="card-face card-front">
          <div className="card-topline"><span className="source-pill">{paper.source}</span><span>Original</span></div>
          <h2>{paper.title}</h2>
          <p className="quote">“{paper.original}”</p>
          <p className="flip-hint">Klikni karticu za prevod ↻</p>
          <CardFooter paper={paper} copyText={copyText} onChat={onChat} />
        </div>
        <div className="card-face card-back">
          <div className="card-topline"><span className="source-pill">Prevod</span><span>Srpski</span></div>
          <h2>{paper.title}</h2>
          <p className="quote translation">{paper.translation || 'Prevod nije dostupan.'}</p>
          <p className="flip-hint">Klikni karticu za original ↻</p>
          <CardFooter paper={paper} copyText={copyText} onChat={onChat} />
        </div>
      </div>
    </article>
  );
}

function CardFooter({ paper, copyText, onChat }) {
  return (
    <div className="card-footer" onClick={(event) => event.stopPropagation()}>
      <div className="meta"><strong>{paper.author}</strong><span>{paper.date?.slice(0, 4)}</span></div>
      <div className="card-actions">
        <button className="icon-button" onClick={copyText}>⧉ Kopiraj</button>
        <button className="icon-button primary" onClick={() => onChat(paper)}>▣ Chat</button>
      </div>
    </div>
  );
}

function Evidence({ quote, onJump }) {
  if (!quote) return null;
  return <div className="evidence"><div className="evidence-heading"><span>Pronađeno u radu</span>{onJump && <button className="jump-button" onClick={onJump} title="Pronađi ovaj citat u radu">↗</button>}</div><mark>{quote}</mark></div>;
}

function PaperReader({ paper, language, onBack }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pdfSource, setPdfSource] = useState(paper.pdfUrl);

  const jumpToQuote = (quote) => {
    const searchText = quote.replace(/\s+/g, ' ').trim().slice(0, 140);
    setPdfSource(`${paper.pdfUrl}#search=${encodeURIComponent(searchText)}`);
  };

  const askAboutPaper = async (event) => {
    event.preventDefault();
    if (!question.trim() || loading) return;
    const currentQuestion = question.trim();
    setQuestion('');
    setMessages((items) => [...items, { role: 'user', text: currentQuestion }]);
    setLoading(true);
    try {
      const response = await axios.post(`${API_URL}/paper-chat`, { paper, question: currentQuestion, language });
      setMessages((items) => [...items, { role: 'assistant', text: response.data.answer, quote: response.data.quote }]);
    } catch {
      setMessages((items) => [...items, { role: 'assistant', text: 'Nisam uspeo da pronađem odgovor u ovom radu.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="reader-page">
      <header className="reader-header">
        <button className="back-button" onClick={onBack}>← Svi radovi</button>
        <div><span className="eyebrow">Čitanje rada · {paper.source}</span><h1>{paper.title}</h1></div>
        {paper.url && <a className="outline-button" href={paper.url} target="_blank" rel="noreferrer">Otvori izvor ↗</a>}
      </header>
      <div className="reader-grid">
        <section className="chat-panel">
          <div className="panel-heading"><span className="status-dot" /> Chatbot za ovaj rad</div>
          <p className="panel-intro">Postavi pitanje. Odgovor će biti zasnovan samo na tekstu izabranog rada.</p>
          <div className="messages">
            {messages.length === 0 && <div className="empty-chat"><span>✦</span><p>Šta želiš da saznaš iz ovog rada?</p></div>}
            {messages.map((message, index) => (
              <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                <div className="message-label">{message.role === 'user' ? 'Ti' : 'Gemini'}</div>
                <p>{message.text}</p>
                {message.quote && <Evidence quote={message.quote} onJump={paper.pdfUrl ? () => jumpToQuote(message.quote) : null} />}
              </div>
            ))}
            {loading && <div className="message assistant"><div className="message-label">Gemini</div><p className="typing">Tražim odgovor u radu<span>…</span></p></div>}
          </div>
          <form className="chat-form" onSubmit={askAboutPaper}>
            <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Pitaj nešto o ovom radu..." />
            <button className="send-button" disabled={loading}>↑</button>
          </form>
        </section>
        <section className="pdf-panel">
          <div className="panel-heading"><span className="pdf-icon">▤</span> Rad u PDF-u</div>
          {paper.pdfUrl ? (
            <iframe className="native-pdf-frame" title={`PDF: ${paper.title}`} src={pdfSource} />
          ) : (
            <div className="abstract-reader"><div className="pdf-unavailable">Ovaj rad nema javno dostupan PDF preko OpenAlex-a. Prikazujem apstrakt.</div>{(paper.landingUrl || paper.url) && <a className="paper-source-link" href={paper.landingUrl || paper.url} target="_blank" rel="noreferrer">Otvori rad na izvornom sajtu ↗</a>}<p>{paper.fullText}</p></div>
          )}
        </section>
      </div>
    </main>
  );
}

function App() {
  const [question, setQuestion] = useState('');
  const [papers, setPapers] = useState([]);
  const [language, setLanguage] = useState('Srpski');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedPaper, setSelectedPaper] = useState(null);

  const search = async (event) => {
    event.preventDefault();
    if (!question.trim() || loading) return;
    setLoading(true);
    setError('');
    setSelectedPaper(null);
    try {
      const response = await axios.post(`${API_URL}/ask`, { question });
      setPapers(response.data.papers || []);
      setLanguage(response.data.language || 'Srpski');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Došlo je do greške. Proveri da li backend radi.');
    } finally {
      setLoading(false);
    }
  };

  if (selectedPaper) return <PaperReader paper={selectedPaper} language={language} onBack={() => setSelectedPaper(null)} />;

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="brand-mark">R<span>·</span>B</div>
        <span className="eyebrow">AI research companion</span>
        <h1>Razumi nauku<br /><em>iz izvora.</em></h1>
        <p>Postavi pitanje. Pronađi tri rada. Čitaj, prevedi i razgovaraj sa svakim izvorom.</p>
        <form className="search-box" onSubmit={search}>
          <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="npr. Kako crne rupe utiču na vreme?" />
          <button className="search-button" disabled={loading}>{loading ? 'Tražim...' : 'Istraži →'}</button>
        </form>
        {error && <div className="error-box">{error}</div>}
      </header>

      {papers.length > 0 && (
        <section className="results-section">
          <div className="results-heading"><div><span className="eyebrow">Odabrani izvori</span><h2>Tri rada za tvoje pitanje</h2></div><span className="result-count">{papers.length} izvora · klikni karticu za prevod</span></div>
          <div className="cards-grid">{papers.map((paper, index) => <PaperCard key={`${paper.url}-${index}`} paper={paper} onChat={setSelectedPaper} />)}</div>
        </section>
      )}

      {papers.length === 0 && !loading && <div className="welcome-note"><span>✦</span><p>Rezultati će se pojaviti ovde. Svaka kartica sadrži originalni odlomak i prevod.</p></div>}
    </main>
  );
}

export default App;
