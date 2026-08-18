const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

function reconstructAbstract(invertedIndex) {
    if (!invertedIndex) return null;
    try {
        const words = [];
        for (const [word, positions] of Object.entries(invertedIndex)) {
            positions.forEach(pos => words[pos] = word);
        }
        return words.join(' ').replace(/\s+/g, ' ').trim();
    } catch (error) {
        return null;
    }
}

function decodeXml(value) {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

function readXmlTag(entry, tagName) {
    const match = entry.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`));
    return match ? decodeXml(match[1]) : '';
}

function parseJsonResponse(text) {
    try {
        const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
        return JSON.parse(cleaned);
    } catch (error) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start < 0 || end < start) return null;
        try {
            return JSON.parse(text.slice(start, end + 1));
        } catch (nestedError) {
            return null;
        }
    }
}

async function callGemini(prompt, jsonMode = false) {
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
        console.error('GEMINI_API_KEY is not configured');
        return null;
    }

    const genAI = new GoogleGenerativeAI(API_KEY);
    const models = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];

    for (const modelName of models) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: jsonMode
                    ? { responseMimeType: 'application/json', temperature: 0.2 }
                    : { temperature: 0.2 }
            });
            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (error) {
            console.error(`GEMINI MODEL ERROR (${modelName}):`, error.message);
        }
    }

    return null;
}

async function searchArxiv(query) {
    try {
        const response = await axios.get('https://export.arxiv.org/api/query', {
            params: {
                search_query: `all:"${query}"`,
                start: 0,
                max_results: 10,
                sortBy: 'relevance',
                sortOrder: 'descending'
            },
            headers: { 'User-Agent': 'ResearchBot/1.0' }
        });

        return [...response.data.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
            .map(([, entry]) => {
                const url = readXmlTag(entry, 'id');
                return {
                    title: readXmlTag(entry, 'title'),
                    fullText: readXmlTag(entry, 'summary'),
                    url,
                    pdfUrl: url.replace('/abs/', '/pdf/') + '.pdf',
                    author: [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
                        .map(([, name]) => decodeXml(name)).join(', ') || 'Nepoznat autor',
                    date: readXmlTag(entry, 'published').slice(0, 10) || 'Nepoznat datum',
                    source: 'arXiv'
                };
            })
            .filter(paper => paper.title && paper.fullText);
    } catch (error) {
        console.error('ARXIV API ERROR:', error.message);
        return [];
    }
}

async function extractQuestion(question) {
    const prompt = `Korisnik pita: "${question}".
Identifikuj glavni naučni pojam o kojem korisnik želi objašnjenje.
Odgovori isključivo u formatu:
DETEKTOVAN_JEZIK: [Ime jezika]
SRZ_POJMA: [Pojam na jeziku korisnika]
UPIT: [Engleski naučni pojam]`;

    const extracted = await callGemini(prompt);
    if (!extracted) return null;

    return {
        detectedLanguage: extracted.split('DETEKTOVAN_JEZIK:')[1]?.split('SRZ_POJMA:')[0]?.trim() || 'Srpski',
        srzPojma: extracted.split('SRZ_POJMA:')[1]?.split('UPIT:')[0]?.trim() || question,
        cleanQuery: extracted.split('UPIT:')[1]?.replace(/["']/g, '').trim() || question
    };
}

function normalizeOpenAlexWork(work) {
    return {
        title: work.display_name,
        fullText: reconstructAbstract(work.abstract_inverted_index),
        url: work.doi || `https://openalex.org/${work.id}`,
        pdfUrl: work.primary_location?.pdf_url || work.best_oa_location?.pdf_url || null,
        author: work.authorships?.map(a => a.author.display_name).join(', ') || 'Nepoznat autor',
        date: work.publication_date || 'Nepoznat datum',
        source: 'OpenAlex'
    };
}

async function findPapers(query) {
    const searchRes = await axios.get('https://api.openalex.org/works', {
        params: { search: query, filter: 'has_abstract:true', per_page: 15 }
    });

    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const openAlexPapers = searchRes.data.results
        .map(normalizeOpenAlexWork)
        .filter(paper => paper.fullText && words.every(word => paper.fullText.toLowerCase().includes(word)))
        .slice(0, 10);

    const arxivPapers = await searchArxiv(query);
    const selected = [...openAlexPapers.slice(0, 5), ...arxivPapers.slice(0, 5)]
        .filter((paper, index, papers) => papers.findIndex(p => p.url === paper.url) === index)
        .slice(0, 10);

    if (selected.length >= 3) return selected;

    return [...selected, ...searchRes.data.results
        .map(normalizeOpenAlexWork)
        .filter(paper => paper.fullText && !selected.some(item => item.url === paper.url))
        .slice(0, 10 - selected.length)];
}

async function createPaperCards(papers, srzPojma, detectedLanguage, cleanQuery) {
    const context = papers.map((paper, index) =>
        `--- RAD ${index + 1} ---\nURL: ${paper.url}\nNASLOV: ${paper.title}\nAUTOR: ${paper.author}\nDATUM: ${paper.date}\nIZVOR: ${paper.source}\nABSTRAKT: ${paper.fullText}\n---`
    ).join('\n\n');

    const prompt = `Korisnik želi stručno objašnjenje pojma "${srzPojma}" na jeziku "${detectedLanguage}".
Izaberi tačno 3 različita rada iz ponuđenih radova koji najbolje objašnjavaju pojam "${cleanQuery}".
Vrati ISKLJUČIVO validan JSON sledećeg oblika:
{"papers":[{"url":"URL iz podataka","title":"naslov","original":"doslovan pasus iz ABSTRAKTA na engleskom","translation":"tačan prevod pasusa na ${detectedLanguage}","explanation":"kratko stručno objašnjenje na ${detectedLanguage}"}]}
Pravila:
- Koristi samo tekst iz priloženih apstrakata.
- Original mora biti doslovan citat; nemoj izmišljati tekst.
- Ako je apstrakt kratak, citiraj najrelevantniji dostupan deo.
- URL mora biti preuzet iz podataka.
- Ne dodaj markdown ni tekst izvan JSON-a.

PODACI:
${context}`;

    const response = await callGemini(prompt, true);
    const parsed = response && parseJsonResponse(response);
    if (!parsed?.papers?.length) return null;

    return parsed.papers.slice(0, 3).map((paper, index) => {
        const sourcePaper = papers.find(item => item.url === paper.url) || papers[index];
        return {
            ...sourcePaper,
            title: paper.title || sourcePaper.title,
            original: paper.original || sourcePaper.fullText,
            translation: paper.translation || '',
            explanation: paper.explanation || ''
        };
    });
}

app.post('/ask', async (req, res) => {
    try {
        const { question } = req.body;
        if (!question?.trim()) return res.status(400).json({ error: 'Pitanje je obavezno.' });

        const extracted = await extractQuestion(question);
        if (!extracted) return res.status(503).json({ error: 'Gemini API nije dostupan.' });

        const papers = await findPapers(extracted.cleanQuery);
        const cards = await createPaperCards(papers, extracted.srzPojma, extracted.detectedLanguage, extracted.cleanQuery);
        if (!cards) return res.status(503).json({ error: 'Gemini nije mogao da formatira rezultate.' });

        res.json({ papers: cards, language: extracted.detectedLanguage, query: extracted.cleanQuery });
    } catch (error) {
        console.error('SERVER ERROR:', error.message);
        res.status(500).json({ error: 'Greška pri obradi zahteva.' });
    }
});

app.post('/paper-chat', async (req, res) => {
    try {
        const { paper, question, language = 'Srpski' } = req.body;
        if (!paper?.fullText || !question?.trim()) {
            return res.status(400).json({ error: 'Rad i pitanje su obavezni.' });
        }

        const prompt = `Odgovori na pitanje korisnika ISKLJUČIVO na osnovu apstrakta rada ispod.
Vrati samo validan JSON:
{"answer":"odgovor na jeziku ${language}","quote":"doslovan relevantan citat iz apstrakta na engleskom"}
Ako odgovor nije moguće pronaći u radu, reci to jasno i kao quote vrati prazan string.

NASLOV: ${paper.title}
APSTRAKT: ${paper.fullText.slice(0, 16000)}

PITANJE: ${question}`;

        const response = await callGemini(prompt, true);
        const result = response && parseJsonResponse(response);
        if (!result) return res.status(503).json({ error: 'Gemini API nije dostupan.' });
        res.json({ answer: result.answer || 'Odgovor nije pronađen u radu.', quote: result.quote || '' });
    } catch (error) {
        console.error('PAPER CHAT ERROR:', error.message);
        res.status(500).json({ error: 'Greška pri razgovoru o radu.' });
    }
});

app.listen(5000, () => console.log('Backend online - ResearchBot'));
