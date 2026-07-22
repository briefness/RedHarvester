document.addEventListener('DOMContentLoaded', () => {
    // API URL 根路径
    const API_BASE = '/api';

    // DOM 元素
    const scrapeForm = document.getElementById('scrape-form');
    const origTitleInput = document.getElementById('orig-title');
    const origAuthorInput = document.getElementById('orig-author');
    const origContentInput = document.getElementById('orig-content');
    
    const reviewCardsList = document.getElementById('review-cards-list');
    const queueCardsList = document.getElementById('queue-cards-list');
    const allCardsList = document.getElementById('all-cards-list');
    
    const pendingCountBadge = document.getElementById('pending-count');
    const approvedCountBadge = document.getElementById('approved-count');
    
    const tabReviewNum = document.getElementById('tab-review-num');
    const tabQueueNum = document.getElementById('tab-queue-num');
    
    const toast = document.getElementById('toast');
    let defaultPrompt = '';
    const replicatingPostIds = new Set();

    // Tab 切换逻辑
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            const targetTab = btn.getAttribute('data-tab');
            document.getElementById(`tab-content-${targetTab}`).classList.add('active');
        });
    });

    // Toast 提示
    function showToast(message, duration = 3000) {
        toast.textContent = message;
        toast.classList.remove('hidden');
        setTimeout(() => {
            toast.classList.add('hidden');
        }, duration);
    }

    // 加载并渲染数据
    async function loadData() {
        try {
            const res = await fetch(`${API_BASE}/posts`);
            if (!res.ok) throw new Error('网络请求失败');
            const posts = await res.json();

            renderDashboard(posts);
        } catch (err) {
            console.error('获取数据失败:', err);
            showToast('⚠️ 无法连接后端API，请检查后端运行状态');
        }
    }

    async function loadGenerationConfig() {
        const res = await fetch(`${API_BASE}/generation-config`);
        if (!res.ok) throw new Error('提示词配置加载失败');
        const config = await res.json();
        defaultPrompt = config.default_prompt || '';
    }

    function getPrompt(postId) {
        return localStorage.getItem(`generation-prompt-v2-${postId}`) ?? defaultPrompt;
    }

    async function replicatePost(postId, prompt, previousTitle = '', previousContent = '') {
        const res = await fetch(`${API_BASE}/posts/${postId}/replicate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                previous_title: previousTitle,
                previous_content: previousContent
            })
        });
        const response = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(response.error || '生成服务响应异常');
        if (response.status !== 'success' || !response.data) throw new Error('AI 返回数据格式不符');
        return response.data;
    }

    function renderDashboard(posts) {
        const reviewPosts = posts.filter(p => p.status === 'AI_GENERATED' || p.status === 'SCRAPED');
        const queuePosts = posts.filter(p => p.status === 'APPROVED' || p.status === 'PUBLISHED');

        // 更新 Badges
        pendingCountBadge.textContent = `待审核: ${reviewPosts.length}`;
        approvedCountBadge.textContent = `待发布: ${posts.filter(p => p.status === 'APPROVED').length}`;
        tabReviewNum.textContent = reviewPosts.length;
        tabQueueNum.textContent = posts.filter(p => p.status === 'APPROVED').length;

        // 渲染待审核区域
        renderReviewList(reviewPosts);
        
        // 渲染发布队列区域
        renderQueueList(queuePosts);

        // 渲染全部爆款
        renderAllList(posts);
    }

    // 渲染待审核列表
    function renderReviewList(posts) {
        if (posts.length === 0) {
            reviewCardsList.innerHTML = `<div class="empty-state" style="text-align:center; padding:40px; color:#9ca3af;">🎉 暂无待审核卡片，你可以输入或抓取新爆款进行 AI 复刻！</div>`;
            return;
        }

        reviewCardsList.innerHTML = posts.map(post => {
            const aiTagsStr = (post.ai_tags || []).join(' ');
            const aiImages = post.ai_images || [];
            const origImages = post.original_images || [];

            return `
                <div class="review-card-wrapper" id="card-${post.id}">
                    <!-- 左侧：原爆款内容 -->
                    <div class="orig-view">
                        <div class="column-header">
                            <span>原爆款图文</span>
                            <span class="tag-badge">源数据</span>
                        </div>
                        <h3 class="orig-title">${escapeHtml(post.original_title)}</h3>
                        <div class="orig-meta">作者/热度: ${escapeHtml(post.author || '匿名')} (${post.likes} 赞)</div>
                        <div class="orig-content">${escapeHtml(post.original_content)}</div>
                        <div class="image-preview-list">
                            ${origImages.map(url => `<img src="${url}" class="img-thumb" alt="原图">`).join('')}
                        </div>
                    </div>

                    <!-- 右侧：AI 复刻人工审核与编辑区 -->
                    <div class="ai-editor">
                        <div class="column-header">
                            <span>火山 Agent Plan 复刻版 (可直接编辑)</span>
                            <span class="tag-badge ai">AI 爆款引擎</span>
                        </div>
                        
                        ${post.status === 'SCRAPED' ? `
                            <div style="padding:20px; text-align:center;">
                                <p style="color:#9ca3af; margin-bottom:12px;">已录入，尚未触发 AI 复刻</p>
                                <button class="btn btn-primary replicate-btn" id="replicate-btn-${post.id}" onclick="triggerReplication(${post.id}, this)">立即生成</button>
                            </div>
                        ` : `
                            <div class="editor-field">
                                <label>AI 生成标题</label>
                                <input type="text" id="ai-title-${post.id}" class="editor-input" value="${escapeHtml(post.ai_title || '')}">
                            </div>
                            <div class="editor-field">
                                <label>AI 生成正文 (含 Emoji 与开场钩子)</label>
                                <textarea id="ai-content-${post.id}" class="editor-textarea" rows="6">${escapeHtml(post.ai_content || '')}</textarea>
                            </div>
                            <div class="editor-field">
                                <label>话题标签 (用空格分隔)</label>
                                <input type="text" id="ai-tags-${post.id}" class="editor-input" value="${escapeHtml(aiTagsStr)}">
                            </div>
                            <div class="editor-field">
                                <label>配图建议</label>
                                <div class="image-preview-list">
                                    ${aiImages.map(url => `<img src="${url}" class="img-thumb" alt="AI配图">`).join('')}
                                </div>
                            </div>
                        `}
                    </div>

                    <div class="prompt-editor">
                        <div class="column-header">
                            <label for="generation-prompt-${post.id}">生成提示词</label>
                            <button class="prompt-reset" type="button" onclick="resetPrompt(${post.id})">恢复默认</button>
                        </div>
                        <textarea id="generation-prompt-${post.id}" class="prompt-textarea" oninput="savePrompt(${post.id}, this.value)" spellcheck="false">${escapeHtml(getPrompt(post.id))}</textarea>
                    </div>

                    <!-- 底部操作按钮 -->
                    <div class="action-bar">
                        <div style="font-size:13px; color:#9ca3af;">ID: #${post.id} · 创建于 ${post.created_at}</div>
                        <div style="display:flex; gap:10px;">
                            ${post.status === 'AI_GENERATED' ? `
                                <button class="btn btn-secondary" onclick="copyAiContent(${post.id})">📋 复制AI文案</button>
                                <button class="btn btn-secondary replicate-btn" id="replicate-btn-${post.id}" onclick="triggerReplication(${post.id}, this)">重新生成</button>
                                <button class="btn btn-danger" onclick="updateReviewStatus(${post.id}, 'REJECTED')">❌ 驳回</button>
                                <button class="btn btn-success" onclick="saveAndApprove(${post.id})">✅ 审核通过，加入发布队列</button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 渲染发布队列 (清晰区分 [待插件自动发布] 与 [已发布历史])
    function renderQueueList(posts) {
        if (posts.length === 0) {
            queueCardsList.innerHTML = `<div class="empty-state" style="text-align:center; padding:40px; color:#9ca3af;">队列为空。审核通过的爆款贴会自动在此展示，等待 Chrome 插件自动发布。</div>`;
            return;
        }

        const approvedList = posts.filter(p => p.status === 'APPROVED');
        const publishedList = posts.filter(p => p.status === 'PUBLISHED');

        let html = '';

        // 1. 待插件自动发布 Section
        if (approvedList.length > 0) {
            html += `<h4 style="color:#60a5fa; margin-bottom:12px; display:flex; align-items:center; gap:8px;">⏳ 待插件自动发布任务 (${approvedList.length})</h4>`;
            html += approvedList.map(post => `
                <div class="section-card" style="display:flex; justify-content:space-between; align-items:center; border-left: 4px solid #3b82f6; margin-bottom:12px;">
                    <div>
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                            <span class="status-pill APPROVED">⏳ 待插件自动发布</span>
                            <h4 style="color:#fff;">${escapeHtml(post.ai_title || post.original_title)}</h4>
                        </div>
                        <div style="font-size:13px; color:#9ca3af;">
                            ID: #${post.id} · 标签: ${(post.ai_tags || []).join(' ')} · 入队时间: ${post.updated_at}
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <button class="btn btn-secondary" style="font-size:12px;" onclick="updateReviewStatus(${post.id}, 'PUBLISHED')">手动标记为已发</button>
                    </div>
                </div>
            `).join('');
        }

        // 2. 插件已发布历史 Section
        if (publishedList.length > 0) {
            html += `<h4 style="color:#34d399; margin-top:20px; margin-bottom:12px; display:flex; align-items:center; gap:8px;">🚀 插件已发布成功历史 (${publishedList.length})</h4>`;
            html += publishedList.map(post => `
                <div class="section-card" style="display:flex; justify-content:space-between; align-items:center; border-left: 4px solid #10b981; opacity:0.88; margin-bottom:12px;">
                    <div>
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                            <span class="status-pill PUBLISHED" style="background:rgba(16,185,129,0.2); color:#34d399;">🚀 已成功自动发布</span>
                            <h4 style="color:#e5e7eb; text-decoration: none;">${escapeHtml(post.ai_title || post.original_title)}</h4>
                        </div>
                        <div style="font-size:13px; color:#9ca3af;">
                            ID: #${post.id} · 成功发布于: ${post.updated_at}
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <span style="color:#34d399; font-size:13px; margin-right:6px;">✔ 发布完成</span>
                        <button class="btn btn-secondary" style="font-size:12px;" onclick="updateReviewStatus(${post.id}, 'APPROVED')">🔄 重新入队(重置)</button>
                    </div>
                </div>
            `).join('');
        }

        queueCardsList.innerHTML = html;
    }

    // 渲染全部
    function renderAllList(posts) {
        allCardsList.innerHTML = posts.map(post => `
            <div class="section-card" style="margin-bottom:12px; padding:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span class="status-pill ${post.status}">${post.status}</span>
                        <strong style="margin-left:8px;">${escapeHtml(post.original_title)}</strong>
                    </div>
                    <span style="font-size:12px; color:#9ca3af;">ID: #${post.id}</span>
                </div>
            </div>
        `).join('');
    }

    // 示例爆款预设库
    const DEMO_PRESETS = [
        {
            title: "听我一句劝！2026普通人做副业千万别再踩这3个坑了！",
            author: "运营小天才 / 5.2万赞",
            content: "很多人做小红书总是三分钟热度，前3天发了2条没播放就放弃了。其实爆款是有固定逻辑的！1. 标题必须有反差；2. 封面要用对比色；3. 前三行一定要抓住人性痛点。今天把底层逻辑一次性讲清楚！"
        },
        {
            title: "答应我！去杭州一定要吃这家藏在巷子里的神仙烘焙店！",
            author: "吃货小探长 / 2.9万赞",
            content: "真的被惊艳到了！他们家的招牌开心果冰淇淋包简直绝了，外皮酥到掉渣，内馅冰凉不甜腻！建议下午3点前去，不然要排队1小时！附详细地址和必点清单👇"
        },
        {
            title: "彻底告别加班！教你用 AI 10分钟搞定一周小红书文案！",
            author: "AI提效专家 / 4.1万赞",
            content: "每天憋文案憋到头秃？其实你缺的不是灵感，而是一套成熟的 AI Prompt 框架。今天分享我用了半年的3个调教公式，直接套用就能产出高互动文案，新手也能轻松上手！"
        }
    ];

    // 表单提交：录入爆款并自动调起火山 AI 重构 (带全套 Loading 与防连点锁定)
    if (scrapeForm) {
        scrapeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = scrapeForm.querySelector('button[type="submit"]');
            const origBtnHtml = submitBtn ? submitBtn.innerHTML : '';

            const title = origTitleInput.value.trim();
            const author = origAuthorInput.value.trim();
            const content = origContentInput.value.trim();

            if (!title) {
                showToast('⚠️ 爆款原标题不能为空');
                return;
            }

            if (submitBtn) {
                submitBtn.innerHTML = `<span style="display:inline-block; animation:spin 1s linear infinite; margin-right:6px;">🔄</span> ⏳ 正在进行 AI 赛道深度重构中...`;
                submitBtn.disabled = true;
                submitBtn.style.opacity = '0.7';
            }

            showToast('⏳ 正在录入素材并调起火山 AI 赛道引擎...');

            try {
                const res = await fetch(`${API_BASE}/posts/scrape`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, author, content })
                });

                if (!res.ok) throw new Error('素材录入失败');
                const data = await res.json();
                
                showToast('爆款已录入，正在提取爆款结构并生成新内容...');
                await replicatePost(data.post_id, defaultPrompt);
                await loadData();

                // 自动清空表单
                origTitleInput.value = '';
                origAuthorInput.value = '';
                origContentInput.value = '';

            } catch (err) {
                console.error(err);
                showToast(`❌ ${err.message || '录入或 AI 生成失败'}`);
            } finally {
                if (submitBtn) {
                    submitBtn.innerHTML = origBtnHtml;
                    submitBtn.disabled = false;
                    submitBtn.style.opacity = '1';
                }
            }
        });
    }

    const btnFillDemo = document.getElementById('btn-fill-demo');
    if (btnFillDemo) {
        btnFillDemo.addEventListener('click', () => {
            const randomDemo = DEMO_PRESETS[Math.floor(Math.random() * DEMO_PRESETS.length)];
            origTitleInput.value = randomDemo.title;
            origAuthorInput.value = randomDemo.author;
            origContentInput.value = randomDemo.content;
            showToast('🎲 已填入示范爆款素材！点击“录入”即可体验火山 AI 复刻');
        });
    }

    // 一键复制 AI 复刻内容
    window.copyAiContent = (postId) => {
        const title = document.getElementById(`ai-title-${postId}`)?.value || '';
        const content = document.getElementById(`ai-content-${postId}`)?.value || '';
        const tags = document.getElementById(`ai-tags-${postId}`)?.value || '';
        const fullText = `${title}\n\n${content}\n\n${tags}`;

        navigator.clipboard.writeText(fullText).then(() => {
            showToast('📋 AI 文案已复制到剪贴板！');
        }).catch(err => {
            showToast('❌ 复制失败，请手动选择复制');
        });
    };

    window.savePrompt = (postId, prompt) => {
        localStorage.setItem(`generation-prompt-v2-${postId}`, prompt);
    };

    window.resetPrompt = (postId) => {
        const promptInput = document.getElementById(`generation-prompt-${postId}`);
        if (!promptInput) return;
        promptInput.value = defaultPrompt;
        localStorage.removeItem(`generation-prompt-v2-${postId}`);
        showToast('已恢复默认提示词');
    };

    // 全局绑定 API 操作 (精准局部 Patch 更新，彻底解决 DOM 重新渲染抹平问题)
    window.triggerReplication = async (postId, btnElement) => {
        showToast('⏳ 正在调用火山 Agent Plan 进行赛道深度重构...');

        // 1. 定位 DOM 元素 (无需依赖外层全量重绘)
        const btn = btnElement || document.getElementById(`replicate-btn-${postId}`);
        const titleInput = document.getElementById(`ai-title-${postId}`);
        const contentInput = document.getElementById(`ai-content-${postId}`);
        const tagsInput = document.getElementById(`ai-tags-${postId}`);
        const promptInput = document.getElementById(`generation-prompt-${postId}`);
        const cardWrapper = document.getElementById(`card-${postId}`);

        const origBtnText = btn ? btn.textContent : '重新生成';

        replicatingPostIds.add(postId);
        if (btn) {
            btn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>生成中...</span>';
            btn.disabled = true;
            btn.classList.add('btn-loading');
            btn.setAttribute('aria-busy', 'true');
        }

        if (titleInput) {
            titleInput.classList.add('is-generating');
        }
        if (contentInput) {
            contentInput.classList.add('is-generating');
        }

        try {
            const aiData = await replicatePost(
                postId,
                promptInput?.value || defaultPrompt,
                titleInput?.value || '',
                contentInput?.value || ''
            );

            if (titleInput) titleInput.value = aiData.ai_title || '';
            if (contentInput) contentInput.value = aiData.ai_content || '';
            if (tagsInput && aiData.ai_tags) tagsInput.value = aiData.ai_tags.join(" ");

            if (cardWrapper) {
                cardWrapper.style.transition = "box-shadow 0.4s ease, border-color 0.4s ease";
                cardWrapper.style.boxShadow = "0 0 30px rgba(52, 211, 153, 0.85)";
                cardWrapper.style.borderColor = "#34d399";
                setTimeout(() => {
                    cardWrapper.style.boxShadow = "none";
                    cardWrapper.style.borderColor = "var(--border-color)";
                }, 2000);
            }

            showToast('✨ 爆款结构复刻完成，已生成新的原创表达');
            if (!titleInput || !contentInput) await loadData();
        } catch (err) {
            console.error("[triggerReplication Error]:", err);
            showToast(`❌ ${err.message || 'AI 复刻失败'}`);
        } finally {
            replicatingPostIds.delete(postId);
            if (btn) {
                btn.textContent = origBtnText;
                btn.disabled = false;
                btn.classList.remove('btn-loading');
                btn.removeAttribute('aria-busy');
            }
            titleInput?.classList.remove('is-generating');
            contentInput?.classList.remove('is-generating');
        }
    };

    window.saveAndApprove = async (postId) => {
        const title = document.getElementById(`ai-title-${postId}`).value.trim();
        const content = document.getElementById(`ai-content-${postId}`).value.trim();
        const tagsRaw = document.getElementById(`ai-tags-${postId}`).value.trim();
        const tags = tagsRaw ? tagsRaw.split(/\s+/).map(t => t.startsWith('#') ? t : `#${t}`) : [];

        showToast('⏳ 保存并加入发布队列...');

        try {
            await fetch(`${API_BASE}/posts/${postId}/review`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'APPROVED',
                    ai_title: title,
                    ai_content: content,
                    ai_tags: tags
                })
            });
            showToast('🚀 已成功审核通过！已推送至 Chrome 插件发布队列。');
            loadData();
        } catch (err) {
            showToast('❌ 操作失败');
        }
    };

    window.updateReviewStatus = async (postId, status) => {
        try {
            await fetch(`${API_BASE}/posts/${postId}/review`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            showToast(`状态已更新为: ${status}`);
            loadData();
        } catch (err) {
            showToast('❌ 状态更新失败');
        }
    };

    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // 初始化加载与定时自动刷新
    loadGenerationConfig()
        .catch(err => console.error('获取提示词失败:', err))
        .finally(loadData);
    setInterval(() => {
        if (replicatingPostIds.size === 0 && !reviewCardsList.contains(document.activeElement)) loadData();
    }, 5000);
});
