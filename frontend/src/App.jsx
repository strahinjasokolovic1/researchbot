import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Document, Page, pdfjs } from 'react-pdf';
import './App.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

const API_URL = 'http://localhost:5000';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function PdfJsViewer({ pdfUrl, quote, focusRequest }) {
  const [pageCount, setPageCount] = useState(0);
  const [pageWidth, setPageWidth] = useState(720);
  const [matchPage, setMatchPage] = useState(null);
  const [matchedRequest, setMatchedRequest] = useState(null);
  const [proxyFailed, setProxyFailed] = useState(false);
  const pageRefs = useRef({});

  useEffect(() => {
    const resize = () => setPageWidth(Math.min(720, Math.max(300, window.innerWidth < 850 ? window.innerWidth - 70 : window.innerWidth * 0.48)));
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    if (matchedRequest === focusRequest && matchPage && pageRefs.current[matchPage]) {
      pageRefs.current[matchPage].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusRequest, matchedRequest, matchPage]);

  const keywords = (quote || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((word) => word.length > 3).slice(0, 12);
  const highlightPattern = keywords.length ? new RegExp(`(${keywords.map(escapeRegExp).join('|')})`, 'gi') : null;
  const highlightText = ({ str }) => highlightPattern ? str.replace(highlightPattern, '<mark>$1</mark>') : str;

  const handleText = (pageNumber, textContent) => {
    if ((matchedRequest === focusRequest && matchPage) || !keywords.length) return;
    const items = Array.isArray(textContent) ? textContent : textContent.items || [];
    const pageText = items.map((item) => item.str).join(' ').toLowerCase();
    const matches = keywords.filter((word) => pageText.includes(word.toLowerCase())).length;
    if (matches >= Math.min(2, keywords.length)) {
      setMatchedRequest(focusRequest);
      setMatchPage(pageNumber);
    }
  };

  if (proxyFailed) {
    return <div className="pdf-fallback"><div className="pdf-highlight-note">Ovaj izdavač ne dozvoljava preuzimanje PDF-a kroz aplikaciju. Otvaram native browser viewer.</div><iframe className="external-pdf-frame" title="PDF rada" src={pdfUrl} /></div>;
  }

  return (
    <div className="pdf-scroll-area">
      {quote && <div className="pdf-highlight-note">Strelica iz chata vodi na stranicu sa žutim highlightom.</div>}
      <Document file={`${API_URL}/paper-pdf?url=${encodeURIComponent(pdfUrl)}`} onLoadSuccess={({ numPages }) => setPageCount(numPages)} onLoadError={() => setProxyFailed(true)} loading={<div className="pdf-loading">Učitavam PDF…</div>} error={<div className="pdf-loading">PDF nije moguće učitati.</div>}>
        {Array.from({ length: pageCount }, (_, index) => {
          const pageNumber = index + 1;
          return <div className="pdf-page-wrap" ref={(element) => { pageRefs.current[pageNumber] = element; }} key={pageNumber}>
            <Page pageNumber={pageNumber} width={pageWidth} renderTextLayer renderAnnotationLayer customTextRenderer={highlightText} onGetTextSuccess={(text) => handleText(pageNumber, text)} />
          </div>;
        })}
      </Document>
    </div>
  );
}

function PaperReader({ paper, language, onBack }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pdfFocus, setPdfFocus] = useState(0);
  const latestQuote = [...messages].reverse().find((message) => message.role === 'assistant' && message.quote)?.quote || '';

  const jumpToQuote = () => {
    setPdfFocus((value) => value + 1);
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
            <PdfJsViewer pdfUrl={paper.pdfUrl} quote={latestQuote} focusRequest={pdfFocus} />
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
