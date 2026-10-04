---
name: subito-listing
description: Prepara o migliora un annuncio di vendita per Subito.it — prezzo da comparabili cercati sul web, lista foto, titolo e descrizione pronti da incollare. Usala quando l'utente vuole vendere un oggetto su Subito, ha un annuncio che non vende, o chiede quanto chiedere per un usato.
---

# Annuncio Subito.it

Produci un annuncio pronto da incollare, con un prezzo che regge perché poggia su
**comparabili**: oggetti dello stesso modello e stato, ciascuno con prezzo, fonte,
data e link. Il prezzo viene dai comparabili, mai dalla memoria.

## 1. Scheda oggetto

Chiedi in un solo messaggio ciò che manca, poi aspetta:

- marca e **modello esatto** (versione, capacità, taglia, anno, codice prodotto se c'è)
- stato reale e ogni difetto, anche minimo
- cosa è incluso: scatola, accessori, scontrino, garanzia residua
- città, e se l'utente spedisce (TuttoSubito) o vende solo a mano
- obiettivo: vendere **in fretta** o spuntare il **massimo**
- foto già scattate, se ne ha: allegale e le valuti al passo 4

Fatto quando il modello è identificato abbastanza da cercarne i comparabili: "iPhone"
no, "iPhone 13 128 GB, batteria 86%" sì.

**Veicolo** (auto, moto, scooter)? Leggi [`VEICOLI.md`](VEICOLI.md) prima di
proseguire: scheda, fonti e pagamento cambiano.

**Annuncio già pubblicato.** Leggilo dal link con playwright-cli (vedi passo 2), o
fatti incollare titolo, descrizione, prezzo e foto. Chiedi poi i dati che vede solo
il venditore: giorni online, visualizzazioni, preferiti, messaggi e offerte
ricevute. Leggili come **sintomi**:

- poche visualizzazioni → l'annuncio non viene trovato o non attira: titolo,
  categoria, foto principale
- visualizzazioni ma nessun messaggio → lo scartano dopo averlo aperto: prezzo,
  foto, informazioni mancanti
- messaggi solo con offerte basse → prezzo sopra il mercato

Controlla poi le **impostazioni** dell'annuncio contro l'oggetto reale:

- spedizione: TuttoSubito attivo (tasto Acquista, costo di spedizione) solo se
  l'oggetto imballato rientra nei [vincoli della piattaforma](#vincoli-della-piattaforma);
  altrimenti solo consegna a mano
- condizione: quella selezionata corrisponde allo stato reale ("in confezione
  originale" solo se la confezione c'è)
- pagamento e consegna: coerenti con la descrizione

La scheda si ricava dall'annuncio; chiedi solo ciò che manca. I passi 2–5 valgono
uguali, con l'annuncio attuale come punto di confronto, escluso dai comparabili.

## 2. Ricerca dei comparabili

Distingui sempre due specie di prezzo:

- **venduto** — ciò che qualcuno ha pagato. Pesa di più.
- **richiesto** — un annuncio ancora attivo. È un tetto: su Subito si chiede più di
  quanto si incassa, e gli annunci fermi da mesi sono prezzi che non vendono.

Fonti, in ordine di peso:

1. eBay.it, inserzioni concluse e vendute (filtro "Oggetti venduti") — la fonte più
   larga di **venduto** in Italia.
2. Subito.it, annunci attivi stesso modello — il **richiesto** della concorrenza
   diretta. Nota la città: il ritiro a mano compete solo in zona.
3. Prezzo del nuovo oggi (Trovaprezzi, Idealo, Amazon) — l'**ancora**: l'usato sta
   sotto, e un usato vicino al nuovo non vende.
4. Mercati di settore quando esistono: ricondizionato (Back Market) per
   l'elettronica, listini di settore per veicoli e strumenti.

subito.it ed ebay.it rifiutano fetch e curl (403, protezione Akamai): leggili con
un browser vero, **playwright-cli** (`@playwright/cli`, Node 18+).

- Assente (`command -v playwright-cli`)? Proponi all'utente
  `npm install -g @playwright/cli@latest` e installa solo dopo il suo sì.
- Apri una sessione dedicata: `playwright-cli -s=subito open <url>`, aggiungendo
  `--headed --browser=chrome` se c'è uno schermo e Chrome è installato. Per il
  resto della sintassi (`goto`, `eval`, `snapshot`, `close`) vale
  `playwright-cli --help`.
- URL di partenza:
  `https://www.subito.it/annunci-italia/vendita/<categoria>/?q=<modello>` — la
  categoria come appare negli URL di Subito (`moto-e-scooter`, `informatica`,
  `telefonia`…; `usato` se nessuna calza) — e
  `https://www.ebay.it/sch/i.html?_nkw=<modello>&LH_Sold=1&LH_Complete=1`.
- Sulle ricerche Subito estrai gli annunci con
  [`scripts/annunci.js`](scripts/annunci.js):
  `playwright-cli -s=subito eval "$(cat <cartella della skill>/scripts/annunci.js)"`.
  Restituisce una riga per annuncio, con venditore privato o pro e data
  dell'ultima pubblicazione (un rinnovo la sposta in avanti: un ID nell'URL molto
  più basso dei vicini tradisce un annuncio vecchio). Confronta privato con
  privato. "privato" è solo il tipo di account: leggi il testo, e chi produce o
  vende in serie ("produciamo…", "disponibili in più misure") contalo come pro.
  Un annuncio ripubblicato compare due volte con ID diversi (stesso testo, prezzo
  e km): contalo una volta.
- Naviga a ritmo umano, una pagina alla volta, poche pagine per fonte; chiudi la
  sessione a fine ricerca.
- Una pagina "Access Denied", un captcha o una pagina d'errore di qualunque tipo
  (eBay risponde anche "Something went wrong") è un rifiuto del sito: rispettalo e
  passa al ripiego.

Ripiego, in ordine: `WebSearch` con `site:subito.it` / `site:ebay.it` e il modello,
leggendo i prezzi dagli snippet; poi chiedi all'utente di incollare i risultati di
una ricerca che gli prepari tu, link compreso.

Fatto quando hai **almeno 5 comparabili** dello stesso modello, ognuno con prezzo,
specie (venduto/richiesto), stato, fonte, data e link. Se non arrivi a 5, allarga
(modello adiacente, stato diverso), dichiara la correzione applicata e abbassa la
confidenza.

## 3. Prezzo

- Base: mediana dei **venduti** nello stesso stato; senza venduti, mediana dei
  **richiesti** meno il 10–15%.
- Correggi per ciò che il comparabile non ha: difetti (giù), scatola, scontrino,
  garanzia residua (su).
- Scarta gli outlier e dì quali e perché.
- Con TuttoSubito il compratore paga in più spedizione e Protezione Acquisti:
  confronta il **suo costo totale** con chi vende a mano nella stessa zona.

Restituisci tre numeri:

- **prezzo annuncio** — margine di trattativa del ~10% sopra il minimo
- **minimo accettabile** — sotto questo l'utente rifiuta
- **vendita rapida** — per l'obiettivo "in fretta"

Arrotonda a cifre tonde o psicologiche (95, 149, 290). Accompagna i numeri con la
tabella dei comparabili e una confidenza (alta / media / bassa) motivata. Senza
alcun **venduto** la confidenza è al massimo media.

## 4. Foto

La foto principale è la miniatura nei risultati: oggetto intero, centrato, sfondo
neutro e sgombro, luce naturale diffusa, nessun flash diretto. Le altre:

- ogni lato e l'oggetto in funzione (schermo acceso, motore avviato, luce accesa)
- dettagli che dimostrano il valore: etichetta con modello o seriale, display con
  stato batteria o contachilometri, marchio, misure con un metro accanto
- **ogni difetto**, da vicino — tutela il venditore: un oggetto "non conforme
  all'annuncio" dà diritto al rimborso con la Protezione Acquisti
- tutto ciò che è incluso, disposto insieme in un'unica foto

Foto reali e recenti, mai immagini prese dal web. Componi una **lista di scatti
numerata** per questo oggetto, nell'ordine di caricamento. Se l'utente ha già
foto, valuta ognuna: tienila, rifalla (con il motivo) o scartala. Le foto di un
annuncio pubblicato arrivano in AVIF da `images.sbito.it`: convertile in PNG per
guardarle (`uvx --with pillow python -c "from PIL import Image; …"`).

## 5. Testo

**Titolo**: marca + modello + la caratteristica che fa scegliere (capacità, taglia,
colore). Lo stato va nel campo apposito; nel titolo solo "nuovo" o "sigillato".

**Descrizione**, in questo ordine e in frasi brevi:

1. cos'è, in una riga
2. specifiche: misure, peso, capacità, anno
3. stato reale, difetti compresi, coerente con le foto
4. cosa è incluso
5. perché lo vendi, se aiuta la fiducia
6. consegna: a mano dove, spedizione sì/no; pagamento tramite TuttoSubito se
   spedito, di persona se a mano

Ogni affermazione viene dall'utente, dalle foto o dall'annuncio attuale. Un dato
che manca diventa un segnaposto `[___]` da compilare, e lo elenchi a parte.
Scrivi in modo diretto: le parole chiave cercate (modello, sinonimi comuni)
entrano nel testo naturalmente.

## Vincoli della piattaforma

Rilevati a ottobre 2026, in parte da fonti secondarie; se il modulo di
pubblicazione dice altro, vale il modulo.

- titolo 15–50 caratteri, descrizione fino a 2000
- 6 foto gratuite, fino a 12 con l'opzione a pagamento
- TuttoSubito: pacchi fino a 20 kg; spedizione e Protezione Acquisti a carico del
  compratore, nessuna commissione al venditore privato; pagamento al venditore
  dopo la consegna
- contante: vietati i pagamenti da 5.000 € in su (soglia di legge dal 2023);
  sopra, bonifico istantaneo o assegno circolare
- chi propone di pagare fuori da Subito con un link (WhatsApp, finti "moduli di
  incasso") è una truffa: per ricevere soldi non si inserisce mai la carta

## Consegna

Un unico blocco finale:

1. tabella comparabili e confidenza
2. i tre prezzi
3. lista scatti numerata (o verdetto sulle foto ricevute)
4. categoria e condizione da selezionare
5. titolo, con il conteggio dei caratteri
6. descrizione, con il conteggio dei caratteri

Per un annuncio già pubblicato apri il blocco con la diagnosi (sintomi, causa
probabile, impostazioni da correggere) e mostra ogni parte modificata come
prima → dopo, motivata. Ciò che è già buono resta com'è, dichiarato tale.

Fatto quando titolo e descrizione rientrano nei limiti e ogni affermazione della
descrizione corrisponde a una foto o a un dato fornito dall'utente.
