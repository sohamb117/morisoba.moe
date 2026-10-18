# Typeface sources

Topaz a500 is the original Topaz Kickstart 1.x face. Topaz and MicroKnight are unmodified TrueType files from TrueSchool's Multi Platform Amiga Fonts v1.02, maintained at https://github.com/rewtnull/amigafonts (revision d42987535d94ebbfb51e64fee76f9974c6ae145a). The upstream README, including original authors, credits, GPL font exception declaration, and embedding instructions, is included as AMIGA-README.txt.

Xerox Classic comes from Interlisp's preserved CLASSIC18-MRR and CLASSIC24-MRR Medley display fonts at https://github.com/Interlisp/medley/tree/b542b8e7449cc4d4d4709eea13301c15c107d638/fonts/medleydisplayfonts. These are the archived Classic display glyphs, rather than a contemporary substitute. Xerox's historical OIS Classic identification appears in the 1983 Print Service Fonts document: https://www.bitsavers.org/pdf/xerox/xns_services/services_8.0/Print_Service_Fonts_Jan1983.pdf.

The two WOFF2 files convert only ASCII U+0020–U+007E from those bitmaps to filled pixel outlines, preserving widths and bearings. They use distinct 18/24 families so the small credit and main title use the appropriate source sizes. All 95 advances and glyph contour counts were verified after WOFF2 serialization. Other characters fall back to the system serif. The original MIT license and Xerox/Venue/contributor notice are included as INTERLISP-LICENSE.txt.

To rebuild the two WOFF2 files, download the pinned `CLASSIC18-MRR.MEDLEYDISPLAYFONT` and `CLASSIC24-MRR.MEDLEYDISPLAYFONT` files into a scratch directory and run:

```sh
uv run --with fonttools --with brotli python scripts/build_classic_fonts.py --source-dir /path/to/source-fonts
```

The converter reads only the ASCII charset, preserving original pixel outlines, advances and bearings. It verifies all 95 advances and contour counts after serialization. It does not require a font service at runtime.
