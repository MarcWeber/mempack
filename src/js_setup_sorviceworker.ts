export function setup_service_worker(url:string = "/sw.js"){
  if (!("serviceWorker"in navigator)){
    console.log("no navigator.serviceWorker"); return;
  }
  if ("https:" === location.protocol){
    console.log("no https"); return;
  }
  navigator.serviceWorker.register(url);
}

export const js_setup_service_worker = (opts:{log: boolean, path?: string, js_no_serviceWorker?:string, js_serviceWorker?: string}) => {
    const no_s = (reason:string) => {
        opts.js_no_serviceWorker ? `${opts.js_no_serviceWorker}(${reason})` : "";
    };
    return `
  var t = new Date();
  if  ("serviceWorker" in navigator){
    navigator.serviceWorker.register(${JSON.stringify(opts.path || "/sw.js")}).then(
      function(s){
        var time = new Date().getTime() - t.getTime();
        ${opts.log ? 'console.log("serviceWorker setup after ", time s);' : ''}
        ${opts.js_serviceWorker}({'time': time})
      },
      function(e){
        const reason = {"message": "serviceWorker setup failed", "exception": e}
        ${opts.log ? 'console.log(reason.message, e);' : ''}
        ${no_s("reason")}
      },
    )
  } else {
    ${no_s("{\"message\": \"browser does not support serviceWorker\"}")}
  }
  `;
}
