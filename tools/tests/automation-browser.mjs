export async function checkAutomationStatus({ client, navigate, evaluate, waitForCondition, baseUrl, assert }) {
  const script = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `{
    window.statusCalls = 0;
    window.statusFail = false;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      if (String(url).includes("/status")) {
        window.statusCalls++;
        if (window.statusFail) throw new Error("connection refused");
        return new Response(JSON.stringify({checkedAt:"2026-11-04T00:00:00Z",jobs:[
          {title:"수집",status:"실패",state:"Ready",result:1,stages:["수집 완료", "게시 실패 <script>"],details:[]},
          {title:"대입 분석",status:"실행 중",state:"Running",result:267009,stages:["분석 시작"],details:[]}
        ]}));
      }
      if (String(url).includes("/api/ai-trend")) return new Response(JSON.stringify({
        delayed:true,serverNow:"2026-11-04T00:00:00Z",entry:{id:"2026-11-03-19"}
      }));
      if (String(url).includes("api.github.com")) return new Response(JSON.stringify({
        workflow_runs:[{created_at:new Date().toISOString(),status:"completed",conclusion:"failure"}]
      }));
      return originalFetch(url, options);
    };
  }` });
  try {
    await navigate(client, baseUrl + "/apps/automation-status/");
    await waitForCondition(client, 'document.querySelectorAll(".card").length === 4 && !document.querySelector("#refresh").disabled');
    assert.match(await evaluate(client, 'document.querySelector("#jobs").textContent'), /게시 실패 <script>/);
    assert.equal(await evaluate(client, 'document.querySelectorAll("#jobs script").length'), 0);
    await evaluate(client, 'document.querySelector("#refresh").click()');
    await waitForCondition(client, 'window.statusCalls === 2 && !document.querySelector("#refresh").disabled');
    await client.send("Emulation.setDeviceMetricsOverride", { width:320, height:900, deviceScaleFactor:1, mobile:true });
    assert.equal(await evaluate(client, 'document.documentElement.scrollWidth <= innerWidth'), true);
    await evaluate(client, 'window.statusFail = true; document.querySelector("#refresh").click()');
    await waitForCondition(client, '!document.querySelector("#refresh").disabled');
    assert.equal(await evaluate(client, 'document.querySelectorAll("#jobs .card").length'), 0);
    assert.match(await evaluate(client, 'document.querySelector("#localMessage").textContent'), /PC 상태 확인 불가/);
  } finally {
    await client.send("Page.removeScriptToEvaluateOnNewDocument", {identifier:script.identifier});
    await client.send("Emulation.clearDeviceMetricsOverride");
  }
}
