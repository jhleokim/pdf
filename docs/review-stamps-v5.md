# Review stamps

Pro → 도장·서명 → 검토 스탬프 offers 16 Korean review labels based on the
provided reference style. New labels use transparent backgrounds and red
`#e60012` ink. A color picker or hexadecimal input changes the label, border
and arrow together. Labels can be customized up to 30 characters. Existing
image-stamp background removal and original colors are unchanged.

Selecting a preset activates placement. Drag the label to move it; drag the
round endpoint to change the curved arrow independently. Direction keys move
the focused label or endpoint by one PDF point (Shift: ten points). Pointer
motion updates only the SVG overlay; release commits one document undo step.
Escape, pointer cancellation and page changes discard an unfinished movement.
The preview's 배치 완료 button or sidebar's 이 배치 확정 retains the placement;
the saved placement's 수정 button reopens it. Use 결과 만들기 to save the PDF.

Current/selected/all-page scopes use the existing page UID targeting. Label
width remains in millimeters. The arrow's offset is proportional to that width;
on smaller pages its endpoint and control points stay inside the page. Moving
the label moves its arrow with it; moving the endpoint leaves the label fixed.
When the endpoint lies inside the label, the connecting curve is hidden.

The label uses the bundled Korean font and a transparent PNG. The arrow is a
separate vector path generated from the same geometry as the interactive SVG,
including offset CropBoxes, page rotation and UserUnit. PNG export combines
both on a transparent image bounded to 2048 pixels. Saving a template in the
existing local shelf retains editable color and arrow metadata. No network
service, AI engine or new font download is required; standalone uses the same
modules.

Validation: 307 automated tests pass without failures or skips. New tests cover
default/custom color normalization, endpoint bounds, 32 rendered PDF direction/
rotation/UserUnit combinations, and page targeting with retained source text.
Browser checks cover independent endpoint drag, Ctrl+Z, custom blue ink, all
eight pages, result generation, reopening a committed placement, and 390×844
layout/drag. Physical Android/iOS touch hardware was not tested.
