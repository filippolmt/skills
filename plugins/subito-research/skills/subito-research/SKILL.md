---
name: subito-research
description: Cerca annunci su Subito.it per chi compra — filtra per criteri, giudica il prezzo sul mercato, segnala le truffe e prepara domande e offerta. Usala quando l'utente vuole trovare o comprare qualcosa su Subito, o valutare un annuncio che ha visto.
---

# Ricerca su Subito.it

Consegna una **shortlist**: gli annunci che rispettano i criteri dell'utente, ognuno
con un giudizio sul prezzo misurato sul **mercato** (gli altri annunci dello stesso
modello) e con i **segnali di truffa** controllati.

## 1. Criteri

Chiedi in un solo messaggio ciò che manca, poi aspetta:

- cosa: modello esatto e varianti accettabili (versione, capacità, taglia)
- budget massimo
- zona: regione o raggio per il ritiro a mano, oppure spedizione
- requisiti minimi: anno, km, stato, accessori
- ciò che lo esclude in ogni caso

Un singolo annuncio da valutare (un link)? Salta al passo 3 con quello, e usa il
passo 2 solo per misurarne il mercato.

## 2. Ricerca

subito.it rifiuta fetch e curl (403, protezione Akamai): leggilo con un browser
vero, **playwright-cli** (`@playwright/cli`, Node 18+).

- Assente (`command -v playwright-cli`)? Proponi all'utente
  `npm install -g @playwright/cli@latest` e installa solo dopo il suo sì.
- Apri una sessione dedicata: `playwright-cli -s=subito open <url>`, aggiungendo
  `--headed --browser=chrome` se c'è uno schermo e Chrome è installato. Per il
  resto della sintassi (`goto`, `eval`, `snapshot`, `close`) vale
  `playwright-cli --help`.
- URL: `https://www.subito.it/annunci-<zona>/vendita/<categoria>/?q=<modello>`
  - `<zona>`: `italia` o una regione (`calabria`, `lombardia`…)
  - `<categoria>` come negli URL di Subito (`moto-e-scooter`, `informatica`,
    `telefonia`…; `usato` se nessuna calza)
  - `&ps=<min>&pe=<max>` filtra il prezzo; metti `pe` un 10–15% sopra il budget,
    per vedere chi accetta trattativa
- Estrai gli annunci con [`scripts/annunci.js`](scripts/annunci.js):
  `playwright-cli -s=subito eval "$(cat <cartella della skill>/scripts/annunci.js)"`.
  Una riga per annuncio: titolo, prezzo, km, anno, città, privato o pro, data, link.
- Ripeti con le grafie alternative del modello ("tracer 9 gt", "tracer 900 gt",
  "tracer9") e scorri le pagine con `&o=2`, `&o=3`…
- Naviga a ritmo umano, una pagina alla volta; chiudi la sessione a fine ricerca.
  Una pagina "Access Denied" o un captcha è un rifiuto del sito: rispettalo e
  ripiega su `WebSearch` con `site:subito.it`.

La ricerca per parola chiave di Subito è larga: mescola modelli vicini della
stessa marca. Tieni solo gli annunci del modello cercato, scarta i doppioni per
link, e unisci in uno solo lo stesso oggetto pubblicato in più città (stesso
titolo, prezzo e km: capita con i concessionari).

Fatto quando le pagine di ogni grafia sono esaurite, o restano solo annunci fuori
modello, e ogni annuncio tenuto ha prezzo, città e link.

## 3. Valutazione

**Mercato**: mediana dei prezzi degli annunci tenuti, a parità di anno e stato
(per i veicoli anche di km). Confronta privato con privato: il pro include
garanzia e chiede di più. "privato" è solo il tipo di account: chi produce o vende
in serie, a leggere il testo, contalo come pro. Giudica ogni annuncio **sotto**, **in linea** o
**sopra** mercato, con lo scarto in percentuale.

Per i migliori candidati, al massimo 10, apri l'annuncio e leggi descrizione,
foto e scheda venditore. Le foto arrivano in AVIF da `images.sbito.it`:
convertile in PNG per guardarle (`uvx --with pillow python -c "from PIL import Image; …"`).

**Segnali di truffa**, da controllare uno per uno:

- prezzo oltre il 25% sotto mercato senza un motivo scritto
- venditore iscritto da poco, senza recensioni, con più annunci di valore simili
- foto da catalogo, con filigrane d'altri siti, o che non mostrano l'esemplare
- testo generico, copiato, o che spinge a scrivere su WhatsApp o per email
- solo spedizione per un oggetto che si ritira di solito a mano, o caparra chiesta
  prima di vedere l'oggetto

Un segnale va citato con l'elemento che lo prova; due o più escludono l'annuncio
dalla shortlist, e lo dici. Pesano soprattutto sul ritiro a mano e su chi spinge a
pagare fuori piattaforma: un acquisto con TuttoSubito è coperto dalla Protezione
Acquisti se l'oggetto non è conforme.

Un numero dichiarato vale quanto la sua fonte. "Batteria 100%" può essere il
livello di carica, o la capacità di una batteria sostituita non originale; i km
vanno visti sul cruscotto. Leggi il testo intero, e dove la fonte manca mettila
tra le domande (schermata di Impostazioni → Batteria, foto del cruscotto).

## 4. Consegna

1. **Shortlist**, ordinata dal migliore: prezzo, giudizio sul mercato (con lo
   scarto), dati chiave (anno, km, stato), città, privato o pro, segnali, link.
2. Per i primi tre:
   - le **domande** da fare al venditore: ciò che l'annuncio non dice e conta per
     il prezzo (tagliandi, difetti, scontrino, motivo della vendita)
   - un'**offerta**: di partenza e massima, motivate dal mercato
3. Mercato misurato: numero di annunci, mediana, fascia di prezzo.
4. Gli esclusi per truffa, con il motivo.

Pagamento sicuro, da ricordare con la shortlist: TuttoSubito per ciò che viaggia
spedito; per il ritiro a mano, vedere l'oggetto prima di pagare. Contante solo
sotto i 5.000 € (limite di legge dal 2023); per i veicoli, bonifico istantaneo o
assegno circolare al passaggio di proprietà in agenzia.

Per tenere d'occhio i nuovi annunci, la ricerca si rilancia con `/loop`.
