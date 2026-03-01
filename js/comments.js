(function() {
    const commentsDiv = document.getElementById("comments");
    const postSlug = commentsDiv.getAttribute("data-page");

    commentsDiv.outerHTML = `
        <h2 id="comments"><a href="#comments">Comments</a></h2>
        <style type="text/css">
            #form *{
                font-family: "inter";
            }
            #form{
                margin-top: 2em;
                display: flex;
                flex-direction: column;
                gap: 9px;
            }
            #form input, #form textarea, #form button{
                font-size: 1em;
                border: 1px solid var(--color-fg-2);
                background-color: var(--color-bg-1);
                color: var(--color-fg-1);
                line-height: 1.5;
                padding: 6px 8px;
            }
            #form textarea{
                height: 6em;
            }
            #form button{
                width: 9em;
                padding: 3px 6px;
            }
            #comments-area{
                margin-top: 2em;
            }
            .comment{
                border-left: 1px solid var(--color-fg-2);
                padding-left: 1em;
                margin-top: 1.5em;
            }
            .comment-name{
                font-weight: bold;
            }
            .comment-info{
                display: flex;
                gap: 1em;
                padding-bottom: 0.5em;
            }
            .comment-datetime{
                color: var(--color-fg-2);
            }
            .comment.pending {
                opacity: 0.5;
            }
        </style>
        <div id="comments-area"></div>
        <form id="form">
            <input id="name" placeholder="Name" required />
            <textarea id="comment" placeholder="Comment" required></textarea>
            <button>Post</button>
        </form>
    `;

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.onload = function() {
        const clientId = localStorage.getItem("comment_client_id") || crypto.randomUUID();
        localStorage.setItem("comment_client_id", clientId);
        const sb = window.supabase.createClient(
            "https://ncuqrrhckzsxiparjbcc.supabase.co",
            "sb_publishable_C_ebFmG7_UsFlHoO-cHWQQ_iqrfzntQ",
            { global: { headers: { "client_id": clientId } } }
        );
        const form = document.getElementById("form");
        const commentsArea = document.getElementById("comments-area");
        form.onsubmit = async (e) => {
            e.preventDefault();
            await sb.from("comments").insert([{
                post_slug: postSlug,
                name: form.querySelector("#name").value,
                comment: form.querySelector("#comment").value,
                client_id: clientId
            }]);
            form.reset();
            await load();
        };
        function escapeHtml(text) {
            const div = document.createElement("div");
            div.innerText = text;
            return div.innerHTML;
        }
        async function load() {
            const { data } = await sb
            .from("comments")
            .select("*")
            .eq("post_slug", postSlug)
            .order("created_at", { ascending: false });
            commentsArea.innerHTML = data.map(c => {
                const date = new Date(c.created_at);
                const formatted =
                    date.getFullYear() + "-" +
                    String(date.getMonth() + 1).padStart(2, "0") + "-" +
                    String(date.getDate()).padStart(2, "0") + " " +
                    String(date.getHours()).padStart(2, "0") + ":" +
                    String(date.getMinutes()).padStart(2, "0") + ":" +
                    String(date.getSeconds()).padStart(2, "0");
                const pending = !c.approved;
                return `
                    <div class="comment ${pending ? 'pending' : ''}">
                        <div class="comment-info">
                            <div class="comment-name">
                            ${escapeHtml(c.name)}
                            ${pending ? '<span class="pending-label"> (awaiting approval)</span>' : ''}
                            </div>
                            <div class="comment-datetime">${formatted}</div>
                        </div>
                        <div class="comment-text">${escapeHtml(c.comment)}</div>
                    </div>
                `;
            }).join("");
        }
        load();
    };
    document.head.appendChild(script);
})();