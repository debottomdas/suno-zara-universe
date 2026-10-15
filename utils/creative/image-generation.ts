import OpenAI from 'openai';
import type {VisualSlot} from './model';
// Shared provider adapter. Callers retain their existing ownership, review and
// persistence boundaries; this adapter performs only the configured image request.
export function generateCreativeImage(prompt:string,kind:VisualSlot['kind']) {
 const ai=new OpenAI({apiKey:process.env.OPENAI_API_KEY,maxRetries:0});
 return ai.images.generate({model:'gpt-image-2.5-flare',prompt,size:(kind==='short'?'864x1536':kind==='cover'?'1024x1024':'1536x864') as '1024x1024',quality:'medium',output_format:'png'});
}
