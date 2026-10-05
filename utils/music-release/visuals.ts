import {channelInstructions} from '../channel-dna/instructions';
import type {CreativeWorkspace} from '../creative/model';
import {assertScope,bibleText,sourceKey,type MusicContext,type ProductRecord} from './product';
export function prepareVisual(c:MusicContext,p:ProductRecord,w:CreativeWorkspace,slotId:string) {
 assertScope(c,p);
 if(!c.dna||c.dnaRevision===null)throw Error('An approved active channel DNA revision is required before generating visuals.');
 if(p.sourceKey!==sourceKey(c)||!p.lyricsReviewed||!p.recipeReviewed||!p.recipe||!p.bibleReviewed||!p.bible||w.approvedBible!==bibleText(p.bible))throw Error('Review the current lyrics, Music Direction and Visual Bible before paid image generation.');
 if(p.recipe.input.project.songId!==c.songId||p.recipe.input.project.channelId!==c.channelId||p.recipe.input.lyrics.text!==c.lyrics||p.recipe.input.dna.revision!==c.dnaRevision)throw Error('The recipe does not match this song, channel and active DNA revision.');
 const slot=w.slots.find(s=>s.id===slotId);if(!slot||!slot.prompt.trim())throw Error('Choose a prepared visual slot.');
 const prompt=`${channelInstructions(c,'visual')}\nApproved character/world bible:\n${w.approvedBible}\nSong: ${c.title}\nLanguage: ${c.language}\nMusic Direction: ${JSON.stringify(p.recipe.candidate.direction)}\nLyrics: ${c.lyrics}\nSlot: ${slot.label}\n${slot.prompt}\n${slot.kind==='short'?'9:16 portrait':slot.kind==='cover'?'Square cover artwork':'16:9 landscape'}. Maintain character and world continuity. Follow Channel DNA for branding and lettering; otherwise omit logos and watermark. One polished cinematic image.`;
 return{slot,prompt};
}
