'use client';

// Worked examples, drawn rather than fetched.
//
// A composer with nothing beside it asks someone to invent the format as well as the
// content, and most people answer "make it better" because they do not know what shape
// of answer is useful. An example next to the field is the cheapest possible fix and it
// costs nothing to maintain, because these are drawings: no seed rows in anyone's
// database, no fixtures to keep true, nothing that can be mistaken for real content
// once the panel is full.
//
// They are marked Example in the frame and drawn a shade back from the live cards, so
// nobody spends a moment wondering whether that request was really theirs.

export function ExampleRequest() {
  return (
    <aside className="ex" aria-label="Example of a good request">
      <span className="ex-tag">Example</span>
      <div className="ex-card">
        <span className="cn-st">Open</span>
        <div className="cn-req-b">
          <b>The header sits too close to the logo on mobile</b>
          <p>
            About a thumb of space would do it. Only happens on my phone, the desktop
            one looks right.
          </p>
          <span className="ex-shot" aria-hidden="true">
            <svg viewBox="0 0 200 108">
              <rect className="pg" x="1" y="1" width="198" height="106" rx="3" />
              <rect className="bar" x="1" y="1" width="198" height="19" rx="3" />
              <circle className="mk" cx="16" cy="10.5" r="4.5" />
              <rect className="mk" x="26" y="8" width="34" height="5" rx="2.5" />
              <rect className="mk" x="150" y="8" width="18" height="5" rx="2.5" />
              <rect className="mk" x="172" y="8" width="18" height="5" rx="2.5" />
              <rect className="hl" x="10" y="21" width="60" height="3" rx="1.5" />
              <rect className="tx" x="10" y="34" width="98" height="8" rx="2" />
              <rect className="tx" x="10" y="48" width="72" height="5" rx="2" />
              <rect className="tx" x="10" y="58" width="84" height="5" rx="2" />
              <rect className="im" x="120" y="32" width="70" height="46" rx="3" />
              <rect className="tx" x="10" y="76" width="46" height="9" rx="4.5" />
            </svg>
            <i>a shot of the page, marked where you mean</i>
          </span>
        </div>
      </div>
      <p className="ex-why">
        What is wrong, roughly what would fix it, and where. Three lines beats three
        paragraphs, and a picture beats describing which header.
      </p>
    </aside>
  );
}

export function ExampleInspiration() {
  return (
    <aside className="ex" aria-label="Example of a useful reference">
      <span className="ex-tag">Example</span>
      <figure className="ex-pin">
        <span className="ex-img" aria-hidden="true">
          <svg viewBox="0 0 160 200">
            <rect className="pg" x="0" y="0" width="160" height="200" rx="4" />
            <rect className="im" x="0" y="0" width="160" height="132" />
            <path className="ln" d="M0 108 L46 74 L80 100 L118 60 L160 96 V132 H0 Z" />
            <circle className="dot" cx="118" cy="34" r="13" />
            <rect className="tx" x="14" y="148" width="96" height="7" rx="3.5" />
            <rect className="tx" x="14" y="163" width="64" height="5" rx="2.5" />
            <rect className="tx" x="14" y="176" width="78" height="5" rx="2.5" />
          </svg>
        </span>
        <figcaption>
          <p>
            The way the picture runs right to the edge with no frame around it. Feels
            calm rather than staged.
          </p>
          <span className="in-src">pinterest.com <i>&#8599;</i></span>
        </figcaption>
      </figure>
      <p className="ex-why">
        The line under it is the whole point. An image on its own is a mood, and a mood
        cannot be built from. Say what you liked and I can use it.
      </p>
    </aside>
  );
}
