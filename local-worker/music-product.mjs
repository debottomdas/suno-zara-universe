export function productScope(project,scope) {
  if(!scope.projectId||!scope.userId||!scope.channelId)throw Error('Song, account and channel are required.');
  const saved=project.musicProduct;
  if(saved&&(saved.userId!==scope.userId||saved.channelId!==scope.channelId||saved.songId!==scope.projectId))throw Error('Local campaign belongs to another account or channel.');
}
export function saveProduct(project,scope,record,workspace,snapshot) {
  productScope(project,scope);
  if(!record||record.version!==1||record.userId!==scope.userId||record.channelId!==scope.channelId||record.songId!==scope.projectId)throw Error('Invalid local campaign scope.');
  if(workspace&&(!Array.isArray(workspace.slots)||workspace.slots.length>40))throw Error('Invalid local creative workspace.');
  if(snapshot){const c=snapshot.context;if(!c||c.userId!==scope.userId||c.channelId!==scope.channelId||c.songId!==scope.projectId)throw Error('Invalid local snapshot scope.');project.musicSnapshot={...project.musicSnapshot,...structuredClone(snapshot)};}
  project.musicProduct=structuredClone(record);if(workspace)project.musicWorkspace=structuredClone(workspace);
  return{record:project.musicProduct,workspace:project.musicWorkspace||null};
}
