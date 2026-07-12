# Due Diligence Documents

Drop the due diligence documents for a listing into a folder named after the
listing's JSON file (without `.json`):

```
auctions/documents/
└── 133_halsted_st_lowell_in_46356/
    ├── title_commitment.pdf
    ├── inspection_report.pdf
    ├── rent_roll.pdf
    └── tax_record.txt
```

Supported: `.pdf`, `.txt`, `.md`. The Due Diligence Agent finds this folder
automatically, or point it anywhere with `--docs <folder>`:

```
npm run dd -- auctions/listings/133_halsted_st_lowell_in_46356.json
npm run dd -- auctions/listings/133_halsted_st_lowell_in_46356.json --docs ~/Downloads/halsted_docs
```

Cloud sources (s3://…) are planned — see `agents/due_diligence/document_sources.js`.
