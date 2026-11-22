let repairInstallPrompt=null;

function completeRepairPwaStatus(message){
  document.getElementById('pwaOfflineStatus').textContent=message;
}

function renderRepairInstallButton(){
  const button=document.getElementById('pwaInstallButton');
  if(!button)return;
  const installed=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  button.hidden=installed||!window.isSecureContext||!('serviceWorker' in navigator);
}

async function installRepairMonitor(){
  if(repairInstallPrompt){
    const prompt=repairInstallPrompt;
    repairInstallPrompt=null;
    try{
      await prompt.prompt();
      const choice=await prompt.userChoice;
      if(choice.outcome==='accepted'){
        renderRepairInstallButton();
        return;
      }
    }catch{
      // The browser may revoke the install prompt after navigation.
    }
  }
  openModal('pwaInstallModal');
}

function initializeRepairPwa(){
  renderRepairInstallButton();
  if(!window.isSecureContext||!('serviceWorker' in navigator))return;
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    repairInstallPrompt=event;
  });
  window.addEventListener('appinstalled',()=>{
    repairInstallPrompt=null;
    closeModal('pwaInstallModal');
    document.getElementById('pwaInstallButton').hidden=true;
  });
  const register=async ()=>{
    const statusTimer=setTimeout(()=>{
      completeRepairPwaStatus('Persiapan offline masih berjalan. Kamu bisa memasang lewat menu Chrome atau Safari, lalu buka aplikasi saat online.');
    },8000);
    try{
      await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
      await navigator.serviceWorker.ready;
      completeRepairPwaStatus('Aplikasi siap dibuka offline. Data yang tersedia adalah salinan terakhir pada perangkat ini.');
    }catch{
      completeRepairPwaStatus('Persiapan offline belum selesai. Muat ulang halaman saat terhubung ke internet.');
    }finally{clearTimeout(statusTimer);}
  };
  void register();
}
