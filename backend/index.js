const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

function reconstructAbstract(invertedIndex) {
    if (!invertedIndex) return null;
    try {
        const words = [];
        for (const [word, positions] of Object.entries(invertedIndex)) {
            positions.forEach(pos => words[pos] = word);
        }
        return words.join(' ').replace(/\s+/g, ' ').trim();
    } catch (e) { return null; }
}

async function callGroq(prompt) {
    const API_KEY = process.env.GROQ_API_KEY;
    if (!API_KEY) {
        console.error("GROQ_API_KEY is not configured");
        return null;
    }
    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1 
            },
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data.choices[0].message.content;
    } catch (err) {
        console.error("GROQ API ERROR:", err.response?.data || err.message);
        return null;
    }
}

app.post('/ask', async (req, res) => {
    try {
        const { question } = req.body;

        // 1. KORAK: AI Ekstrakcija i prevod
        const extractionPrompt = `Korisnik pita: "${question}". 
        Identifikuj glavni naučni pojam (keyword) o kojem korisnik želi objašnjenje.
        Odgovori isključivo u formatu:
        DETEKTOVAN_JEZIK: [Ime jezika]
        SRZ_POJMA: [Pojam na jeziku korisnika]
        UPIT: [Engleski naučni pojam]`;
        
        const extracted = await callGroq(extractionPrompt);
        const detectedLanguage = extracted.split("DETEKTOVAN_JEZIK:")[1]?.split("SRZ_POJMA:")[0]?.trim() || "Srpski";
        const srzPojma = extracted.split("SRZ_POJMA:")[1]?.split("UPIT:")[0]?.trim();
        const cleanQuery = extracted.split("UPIT:")[1]?.replace(/["']/g, "").trim();

        console.log(`Pokušavam pretragu za: ${cleanQuery}`);

        // 2. KORAK: Pretraga OpenAlex-a (Uzimamo top 15 rezultata)
        const searchRes = await axios.get('https://api.openalex.org/works', {
            params: {
                'search': cleanQuery,
                'filter': 'has_abstract:true',
                'per_page': 15 
            }
        });

        const candidatePapers = searchRes.data.results
            .map(work => ({
                title: work.display_name,
                fullText: reconstructAbstract(work.abstract_inverted_index),
                url: work.doi || `https://openalex.org/${work.id}`,
                author: work.authorships?.map(a => a.author.display_name).join(', ') || 'Nepoznat autor',
                date: work.publication_date || 'Nepoznat datum'
            }))
            .filter(p => {
                if (!p.fullText) return false;
                const words = cleanQuery.toLowerCase().split(' ');
                return words.every(word => p.fullText.toLowerCase().includes(word));
            })
            .slice(0, 10); // Šaljemo AI-ju top 10 najboljih pogodaka

        if (candidatePapers.length < 3) {
            // Ako je filter bio prestrog, probaj ponovo bez filtera reči samo sa top rezultatima
             candidatePapers.push(...searchRes.data.results
                .map(work => ({
                    title: work.display_name,
                    fullText: reconstructAbstract(work.abstract_inverted_index),
                    url: work.doi || `https://openalex.org/${work.id}`,
                    author: work.authorships?.map(a => a.author.display_name).join(', ') || 'Nepoznat autor',
                    date: work.publication_date || 'Nepoznat datum'
                })).filter(p => p.fullText).slice(0, 10));
        }

        const contextForAI = candidatePapers.map((p, i) => 
            `--- RAD ${i+1} ---\nNASLOV: ${p.title}\nAUTOR: ${p.author}\nDATUM: ${p.date}\nTEKST: ${p.fullText}\nLINK: ${p.url}\n---`
        ).join("\n\n");

        // 3. KORAK: Finalni trodelni prompt (sada sa 6 tačaka)
        const finalPrompt = `
        Korisnik želi stručno objašnjenje za: "${srzPojma}" na jeziku "${detectedLanguage}".
        
        ZADATAK:
        MORAŠ izabrati TAČNO 3 RAZLIČITA RADA iz ponuđenih 10 koji najbolje definišu pojam. 
        Za SVAKI od ta 3 rada ispiši odgovor koristeći ovih 6 tačaka:

        1. NASLOV: [Naslov rada]
        2. IZVORNI PASUS: [Doslovan citat na engleskom od minimum 4-6 rečenica koji direktno objašnjava "${cleanQuery}"]
        3. PREVOD: [Tačan prevod tog pasusa na ${detectedLanguage}]
        4. OBJAŠNJENJE: [Stručno tumačenje tog pasusa na ${detectedLanguage}]
        5. AUTOR: [Navedi autore iz podataka]
        6. DATUM PUBLIKACIJE: [Navedi datum iz podataka]
        7. LINK: [Navedi URL]

        STRIKTNA PRAVILA:
        - Odgovor MORA sadržati 3 odvojena rada.
        - Izvorni pasus ne sme biti sumiran, mora biti doslovno prepisan.
        - Koristi isključivo podatke iz TEKSTA koji je priložen.
        
        PODACI ZA ANALIZU:
        ${contextForAI}
        `;

        const finalAnswer = await callGroq(finalPrompt);
        res.json({ answer: finalAnswer });

    } catch (error) {
        console.error("SERVER ERROR:", error.message);
        res.status(500).json({ error: "Greška pri obradi zahteva." });
    }
});

app.listen(5000, () => console.log("Backend online - v2.1 Fixed Sort Error"));
