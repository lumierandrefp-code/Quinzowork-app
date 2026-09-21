// Navegação entre abas
async function navigate(pageId) {
  const targetPage = document.getElementById(pageId);
  if (!targetPage || !targetPage.classList.contains('page')) return;

  if (pageId === 'admin') {
    const allowed = await checkAdminAccess();
    document.getElementById('admin-panel').hidden = !allowed;
    document.getElementById('admin-denied').hidden = allowed;
    if (!allowed) {
      showAuthMessage('Você não tem permissão para acessar esta área.', true);
      pageId = 'sistema';
    }
  }

  document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
  targetPage.classList.add('active');

  document.querySelectorAll('.nav-links button').forEach(button => {
    button.setAttribute('aria-current', button.dataset.page === pageId ? 'page' : 'false');
  });

  if (pageId === 'home') {
    renderTestimonials();
    if (testimonialsViewMode === 'carousel') {
      startTestimonialsAutoplay();
    }
  } else {
    stopTestimonialsAutoplay();
  }
}

const PUBLIC_PROFILE_FIELDS = 'id, full_name, avatar_url, role, bio, location, skills, experience, education, website_url, linkedin_url, availability, hourly_rate, professional_title';
let publicProfileId = null;

function showPublicProfileState({ loading = false, error = '', visible = false } = {}) {
  document.getElementById('public-profile-loading').hidden = !loading;
  document.getElementById('public-profile-error').hidden = !error;
  document.getElementById('public-profile-error').innerText = error;
  document.getElementById('public-profile-content').hidden = !visible;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function setPublicProfileLink(id, value) {
  const element = document.getElementById(id);
  const url = safeExternalUrl(value);
  element.innerHTML = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>` : 'Não informado';
}

function updatePublicProfileAvatar(url) {
  const image = document.getElementById('public-profile-avatar');
  const placeholder = document.getElementById('public-profile-placeholder');
  image.hidden = !url;
  placeholder.hidden = Boolean(url);
  if (url) image.src = url;
}

function renderPublicProfile(profile) {
  const text = (value) => value || 'Não informado';
  document.getElementById('public-profile-name').innerText = text(profile.full_name);
  document.getElementById('public-profile-title').innerText = text(profile.professional_title);
  document.getElementById('public-profile-role').innerText = ROLE_LABELS[profile.role] || text(profile.role);
  document.getElementById('public-profile-bio').innerText = text(profile.bio);
  document.getElementById('public-profile-skills').innerText = Array.isArray(profile.skills) && profile.skills.length ? profile.skills.slice(0, 5).join(' · ') : 'Não informado';
  document.getElementById('public-profile-experience').innerText = text(profile.experience);
  document.getElementById('public-profile-education').innerText = text(profile.education);
  document.getElementById('public-profile-availability').innerText = text(profile.availability);
  document.getElementById('public-profile-hourly-rate').innerText = profile.hourly_rate === null || profile.hourly_rate === undefined || profile.hourly_rate === '' ? 'Não informado' : `KZ ${profile.hourly_rate}/hora`;
  document.getElementById('public-profile-location').innerText = text(profile.location);
  setPublicProfileLink('public-profile-website', profile.website_url);
  setPublicProfileLink('public-profile-linkedin', profile.linkedin_url);
  updatePublicProfileAvatar(profile.avatar_url);
  const isOwnProfile = Boolean(currentSession?.user?.id && currentSession.user.id === profile.id);
  document.getElementById('public-profile-edit').hidden = !isOwnProfile;
}

async function openPublicProfile(profileId) {
  if (!profileId) return;
  publicProfileId = profileId;
  showPublicProfileState({ loading: true });
  await navigate('public-profile');
  const { data, error } = await supabaseClient.from('profiles').select(PUBLIC_PROFILE_FIELDS).eq('id', profileId).maybeSingle();
  if (error) {
    showPublicProfileState({ error: 'Não foi possível carregar este perfil.' });
    return;
  }
  if (!data) {
    showPublicProfileState({ error: 'Perfil não encontrado' });
    return;
  }
  renderPublicProfile(data);
  showPublicProfileState({ visible: true });
}

function closePublicProfile() {
  publicProfileId = null;
  navigate(currentSession?.user ? 'sistema' : 'home');
}

function openOwnProfileEditor() {
  navigate('sistema');
  toggleProfileEditor();
}

function openProfileFromUrl() {
  const match = window.location.pathname.match(/^\/profile\/([^/]+)\/?$/);
  if (match) openPublicProfile(decodeURIComponent(match[1]));
}

function openCurrentUserPublicProfile() {
  if (!currentSession?.user?.id) return;
  window.history.pushState({}, '', `/profile/${currentSession.user.id}`);
  openPublicProfile(currentSession.user.id);
}

const JOB_OFFER_FIELDS = 'id, user_id, title, description, category, skills, work_type, location, budget, payment_type, experience_level, status, created_at, updated_at';
let jobOffers = [];
let jobProfiles = {};
let selectedJobOffer = null;

function jobValue(value) {
  return value === null || value === undefined || value === '' ? 'Não informado' : String(value);
}

function jobSkills(value) {
  if (Array.isArray(value)) return value.filter(Boolean).slice(0, 5);
  return String(value || '').split(',').map(skill => skill.trim()).filter(Boolean).slice(0, 5);
}

function formatJobDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data não informada' : date.toLocaleDateString('pt-BR');
}

function formatJobBudget(value, paymentType) {
  if (value === null || value === undefined || value === '') return 'Orçamento não informado';
  return `KZ ${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${paymentType ? `/ ${paymentType.toLowerCase()}` : ''}`;
}

function showJobsMessage(message, isError = false) {
  const element = document.getElementById('jobs-message');
  element.innerText = message;
  element.className = isError ? 'jobs-message error' : 'jobs-message';
}

async function loadJobProfiles(offers) {
  const ids = [...new Set(offers.map(offer => offer.user_id).filter(Boolean))];
  if (!ids.length) return;
  const { data } = await supabaseClient.from('profiles').select('id, full_name, avatar_url').in('id', ids);
  jobProfiles = Object.fromEntries((data || []).map(profile => [profile.id, profile]));
}

function renderJobOffers(offers) {
  const list = document.getElementById('jobs-list');
  const empty = document.getElementById('jobs-empty');
  list.innerHTML = offers.map(offer => {
    const profile = jobProfiles[offer.user_id] || {};
    const skills = jobSkills(offer.skills);
    return `<article class="job-card card"><div class="job-card-heading"><div><span class="job-card-category">${escapeHtml(jobValue(offer.category))}</span><h3>${escapeHtml(jobValue(offer.title))}</h3></div><span class="job-status ${offer.status === 'open' ? '' : 'closed'}">${offer.status === 'open' ? 'Aberta' : 'Encerrada'}</span></div><p class="job-description">${escapeHtml(jobValue(offer.description).slice(0, 180))}${String(offer.description || '').length > 180 ? '...' : ''}</p><div class="job-meta"><span>${escapeHtml(jobValue(offer.work_type))}</span><span>${escapeHtml(jobValue(offer.location))}</span><span>${escapeHtml(formatJobBudget(offer.budget, offer.payment_type))}</span><span>${escapeHtml(jobValue(offer.experience_level))}</span></div><div class="job-skills">${skills.map(skill => `<span>${escapeHtml(skill)}</span>`).join('') || '<span>Sem competências</span>'}</div><div class="job-card-footer"><div class="job-publisher"><div class="job-avatar">${profile.avatar_url ? `<img src="${escapeHtml(profile.avatar_url)}" alt="">` : 'Foto'}</div><span>${escapeHtml(profile.full_name || 'Anunciante')}</span></div><small>${escapeHtml(formatJobDate(offer.created_at))}</small></div><button class="btn-primary" type="button" onclick="openJobOfferDetail('${escapeHtml(offer.id)}')">Ver detalhes</button></article>`;
  }).join('');
  list.hidden = offers.length === 0;
  empty.hidden = offers.length !== 0;
}

function filterJobOffers() {
  const query = document.getElementById('jobs-search').value.trim().toLowerCase();
  const category = document.getElementById('jobs-category').value;
  const workType = document.getElementById('jobs-work-type').value;
  const experience = document.getElementById('jobs-experience').value;
  const payment = document.getElementById('jobs-payment').value;
  const filtered = jobOffers.filter(offer => {
    const searchable = [offer.title, offer.description, offer.category, ...jobSkills(offer.skills)].join(' ').toLowerCase();
    return (!query || searchable.includes(query)) && (!category || offer.category === category) && (!workType || offer.work_type === workType) && (!experience || offer.experience_level === experience) && (!payment || offer.payment_type === payment);
  });
  renderJobOffers(filtered);
}

async function loadJobOffers() {
  const loading = document.getElementById('jobs-loading');
  loading.hidden = false;
  showJobsMessage('');
  const { data, error } = await supabaseClient.from('job_offers').select(JOB_OFFER_FIELDS).eq('status', 'open').order('created_at', { ascending: false });
  loading.hidden = true;
  if (error) {
    jobOffers = [];
    renderJobOffers([]);
    showJobsMessage('Não foi possível carregar as ofertas de trabalho.', true);
    return;
  }
  jobOffers = data || [];
  await loadJobProfiles(jobOffers);
  filterJobOffers();
}

async function loadMyJobOffers() {
  if (!currentSession?.user) {
    showJobsMessage('Entre na sua conta para ver as suas ofertas.', true);
    navigate('sistema');
    return;
  }
  navigate('job-offers');
  document.getElementById('jobs-loading').hidden = false;
  const { data, error } = await supabaseClient.from('job_offers').select(JOB_OFFER_FIELDS).eq('user_id', currentSession.user.id).order('created_at', { ascending: false });
  document.getElementById('jobs-loading').hidden = true;
  if (error) {
    renderJobOffers([]);
    showJobsMessage('Não foi possível carregar as suas ofertas.', true);
    return;
  }
  jobOffers = data || [];
  await loadJobProfiles(jobOffers);
  filterJobOffers();
  showJobsMessage('A mostrar as suas ofertas, incluindo as encerradas.');
}

function openJobOffers() {
  navigate('job-offers');
  document.getElementById('job-offer-detail').hidden = true;
  document.getElementById('jobs-list').hidden = false;
  if (currentSession?.user) document.querySelector('.jobs-publish-button').disabled = false;
  else document.querySelector('.jobs-publish-button').disabled = true;
  loadJobOffers();
}

function resetJobOfferForm() {
  document.getElementById('job-offer-form').reset();
  document.getElementById('job-offer-id').value = '';
  document.getElementById('job-form-title').innerText = 'Publicar oferta';
}

function openJobOfferForm(offer = null) {
  if (!currentSession?.user) {
    showJobsMessage('Entre na sua conta para publicar uma oferta.', true);
    navigate('sistema');
    return;
  }
  resetJobOfferForm();
  if (offer) {
    document.getElementById('job-form-title').innerText = 'Editar oferta';
    document.getElementById('job-offer-id').value = offer.id;
    document.getElementById('job-title').value = offer.title || '';
    document.getElementById('job-description').value = offer.description || '';
    document.getElementById('job-category-form').value = offer.category || '';
    document.getElementById('job-work-type-form').value = offer.work_type || '';
    document.getElementById('job-experience-form').value = offer.experience_level || '';
    document.getElementById('job-payment-form').value = offer.payment_type || '';
    document.getElementById('job-budget').value = offer.budget ?? '';
    document.getElementById('job-location').value = offer.location || '';
    document.getElementById('job-skills').value = jobSkills(offer.skills).join(', ');
  }
  document.getElementById('job-offer-form').hidden = false;
  document.getElementById('job-offer-detail').hidden = true;
  document.getElementById('job-offer-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeJobOfferForm() {
  document.getElementById('job-offer-form').hidden = true;
}

async function saveJobOffer(event) {
  event.preventDefault();
  if (!currentSession?.user) return showJobsMessage('Entre na sua conta para guardar uma oferta.', true);
  const title = document.getElementById('job-title').value.trim();
  const description = document.getElementById('job-description').value.trim();
  const category = document.getElementById('job-category-form').value;
  const workType = document.getElementById('job-work-type-form').value;
  const experience = document.getElementById('job-experience-form').value;
  const payment = document.getElementById('job-payment-form').value;
  const budget = Number(document.getElementById('job-budget').value);
  const location = document.getElementById('job-location').value.trim();
  const skills = jobSkills(document.getElementById('job-skills').value);
  if (!title || !description || !category || !workType || !experience || !payment || !Number.isFinite(budget) || budget < 0 || skills.length > 5 || ((workType === 'Presencial' || workType === 'Híbrido') && !location)) {
    showJobsMessage('Preencha os campos obrigatórios. Use um orçamento válido e até 5 competências.', true);
    return;
  }
  const button = document.getElementById('job-save-button');
  button.disabled = true;
  const id = document.getElementById('job-offer-id').value;
  const payload = { title, description, category, skills, work_type: workType, location, budget, payment_type: payment, experience_level: experience, status: id ? undefined : 'open', updated_at: new Date().toISOString() };
  Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);
  const request = id ? supabaseClient.from('job_offers').update(payload).eq('id', id).eq('user_id', currentSession.user.id).select(JOB_OFFER_FIELDS).single() : supabaseClient.from('job_offers').insert({ ...payload, user_id: currentSession.user.id }).select(JOB_OFFER_FIELDS).single();
  const { data, error } = await request;
  button.disabled = false;
  if (error) {
    showJobsMessage('Não foi possível guardar a oferta. Verifique os dados e tente novamente.', true);
    return;
  }
  closeJobOfferForm();
  showJobsMessage(id ? 'Oferta atualizada com sucesso.' : 'Oferta publicada com sucesso.');
  if (id) jobOffers = jobOffers.map(offer => offer.id === id ? data : offer);
  else jobOffers = [data, ...jobOffers];
  await loadJobProfiles([data]);
  filterJobOffers();
}

async function openJobOfferDetail(id) {
  const detail = document.getElementById('job-offer-detail');
  detail.hidden = false;
  detail.innerHTML = '<p>Carregando oferta...</p>';
  const { data, error } = await supabaseClient.from('job_offers').select(JOB_OFFER_FIELDS).eq('id', id).maybeSingle();
  if (error || !data) {
    detail.innerHTML = '<p class="jobs-message error">Oferta não encontrada ou indisponível.</p>';
    return;
  }
  selectedJobOffer = data;
  await loadJobProfiles([data]);
  const profile = jobProfiles[data.user_id] || {};
  const isOwner = currentSession?.user?.id === data.user_id;
  const skills = jobSkills(data.skills);

  let appSectionHtml = '';
  if (isOwner) {
    appSectionHtml = `
      <div class="job-owner-actions">
        <button class="btn-primary" type="button" onclick="editSelectedJobOffer()">Editar oferta</button>
        <button class="btn-secondary" type="button" onclick="toggleJobOfferStatus('${escapeHtml(data.id)}','${data.status === 'open' ? 'closed' : 'open'}')">${data.status === 'open' ? 'Encerrar oferta' : 'Reabrir oferta'}</button>
        <button class="btn-danger" type="button" onclick="deleteJobOffer('${escapeHtml(data.id)}')">Eliminar oferta</button>
      </div>

      <!-- ÁREA DE CANDIDATOS DA OFERTA (FASE 2) -->
      <section class="job-candidates-section" id="job-candidates-section">
        <div class="candidates-header">
          <div>
            <span class="candidates-eyebrow">GESTÃO DE CANDIDATOS</span>
            <h3 class="candidates-title">Candidatos <span class="candidates-count-badge" id="candidates-count-badge">(...)</span></h3>
          </div>
          <button class="btn-secondary" type="button" onclick="loadJobCandidates('${escapeHtml(data.id)}')">Atualizar candidatos</button>
        </div>
        <p id="candidates-message" class="jobs-message" role="status" aria-live="polite"></p>
        <div id="candidates-container" class="candidates-container">
          <p class="jobs-loading">A carregar candidaturas...</p>
        </div>
      </section>
    `;
  } else if (!currentSession?.user) {
    appSectionHtml = `
      <div class="job-apply-box" id="job-apply-box">
        <div class="job-apply-intro">
          <strong>Interessado nesta oportunidade?</strong>
          <p>Aceda com a sua conta de candidato para se candidatar a esta vaga.</p>
        </div>
        <button class="btn-primary btn-apply-job" id="btn-apply-job" type="button" onclick="handleJobApplicationClick('${escapeHtml(data.id)}')">Candidate-se agora</button>
      </div>
      <p id="job-apply-message" class="jobs-message" role="status" aria-live="polite"></p>
    `;
  } else if (currentProfile?.role === 'business') {
    appSectionHtml = `
      <div class="job-apply-box" id="job-apply-box">
        <div class="job-apply-intro">
          <strong>Conta de Empresa (Business)</strong>
          <p>As candidaturas a ofertas de trabalho estão reservadas para contas de candidatos e profissionais.</p>
        </div>
      </div>
    `;
  } else {
    // Authenticated candidate / job seeker: check if already applied
    let existingApp = null;
    try {
      const { data: appData } = await supabaseClient
        .from('applications')
        .select('id, status, created_at')
        .eq('applicant_id', currentSession.user.id)
        .eq('job_id', data.id)
        .maybeSingle();
      existingApp = appData;
    } catch (err) {
      console.warn('Erro ao verificar candidatura:', err);
    }

    if (existingApp) {
      const statusLabels = {
        pending: 'Pendente',
        reviewed: 'Em análise',
        accepted: 'Aceite',
        rejected: 'Não selecionado'
      };
      const statusLabel = statusLabels[existingApp.status] || (existingApp.status === 'pending' ? 'Pendente' : existingApp.status);
      appSectionHtml = `
        <div class="job-applied-box" id="job-applied-box">
          <div class="job-applied-header">
            <span class="job-applied-badge">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              Já te candidataste a esta oferta
            </span>
            <span class="status-pill status-${escapeHtml(existingApp.status || 'pending')}">${escapeHtml(statusLabel)}</span>
          </div>
          <p class="job-applied-meta">Candidatura enviada em ${escapeHtml(formatJobDate(existingApp.created_at))}.</p>
          <p class="jobs-message success">Já te candidataste a esta oferta.</p>
        </div>
      `;
    } else if (data.status !== 'open') {
      appSectionHtml = `
        <div class="job-apply-box" id="job-apply-box">
          <div class="job-apply-intro">
            <strong>Oferta Encerrada</strong>
            <p>Esta vaga já não se encontra a aceitar novas candidaturas.</p>
          </div>
          <button class="btn-secondary" type="button" disabled>Oferta encerrada</button>
        </div>
      `;
    } else {
      appSectionHtml = `
        <div class="job-apply-box" id="job-apply-box">
          <div class="job-apply-intro">
            <strong>Candidate-se a esta vaga</strong>
            <p>Submeta a sua candidatura profissional com o seu perfil Quinzowork.</p>
          </div>
          <button class="btn-primary btn-apply-job" id="btn-apply-job" type="button" onclick="submitJobApplication('${escapeHtml(data.id)}')">Candidate-se agora</button>
        </div>
        <p id="job-apply-message" class="jobs-message" role="status" aria-live="polite"></p>
      `;
    }
  }

  detail.innerHTML = `<div class="profile-heading"><div><span class="eyebrow">DETALHES DA OFERTA</span><h2>${escapeHtml(jobValue(data.title))}</h2><p>${escapeHtml(jobValue(data.category))} · ${escapeHtml(jobValue(data.work_type))}</p></div><button class="btn-secondary" type="button" onclick="closeJobOfferDetail()">Voltar</button></div><p class="job-detail-description">${escapeHtml(jobValue(data.description))}</p><div class="job-detail-grid"><div><strong>Competências</strong><p>${escapeHtml(skills.join(' · ') || 'Não informado')}</p></div><div><strong>Localização</strong><p>${escapeHtml(jobValue(data.location))}</p></div><div><strong>Remuneração</strong><p>${escapeHtml(formatJobBudget(data.budget, data.payment_type))}</p></div><div><strong>Experiência</strong><p>${escapeHtml(jobValue(data.experience_level))}</p></div><div><strong>Estado</strong><p>${data.status === 'open' ? 'Aberta' : 'Encerrada'}</p></div><div><strong>Publicada em</strong><p>${escapeHtml(formatJobDate(data.created_at))}</p></div></div><div class="job-detail-publisher"><div class="job-avatar">${profile.avatar_url ? `<img src="${escapeHtml(profile.avatar_url)}" alt="">` : 'Foto'}</div><div><strong>${escapeHtml(profile.full_name || 'Anunciante')}</strong><button class="btn-secondary" type="button" onclick="openPublicProfile('${escapeHtml(data.user_id)}')">Ver perfil</button></div></div>${appSectionHtml}`;
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (isOwner) {
    loadJobCandidates(data.id);
  }
}

function handleJobApplicationClick(jobOfferId) {
  if (!currentSession?.user) {
    showJobApplyMessage('Inicie sessão ou crie uma conta de candidato para se candidatar a esta oferta.', true);
    setTimeout(() => {
      navigate('sistema');
      showAuthMessage('Inicie sessão ou crie uma conta para se candidatar à oferta de trabalho.');
    }, 600);
    return;
  }
  submitJobApplication(jobOfferId);
}

function showJobApplyMessage(message, isError = false) {
  const el = document.getElementById('job-apply-message');
  if (el) {
    el.innerText = message;
    el.className = isError ? 'jobs-message error' : 'jobs-message success';
  }
}

async function submitJobApplication(jobOfferId) {
  if (!currentSession?.user) {
    handleJobApplicationClick(jobOfferId);
    return;
  }

  if (currentProfile?.role === 'business') {
    showJobApplyMessage('Contas de Empresa não podem candidatar-se a ofertas de trabalho.', true);
    return;
  }

  const applyBtn = document.getElementById('btn-apply-job');
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.innerText = 'A enviar candidatura...';
  }
  showJobApplyMessage('A processar a sua candidatura...');

  try {
    // 1. Prevent duplicate application
    const { data: existingApp } = await supabaseClient
      .from('applications')
      .select('id, status')
      .eq('applicant_id', currentSession.user.id)
      .eq('job_id', jobOfferId)
      .maybeSingle();

    if (existingApp) {
      showJobApplyMessage('Já te candidataste a esta oferta.', true);
      if (applyBtn) {
        applyBtn.innerText = 'Já te candidataste a esta oferta.';
        applyBtn.disabled = true;
      }
      return;
    }

    // 2. Insert into applications table with status "pending"
    const payload = {
      applicant_id: currentSession.user.id,
      job_id: jobOfferId,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error } = await supabaseClient
      .from('applications')
      .insert(payload);

    if (error) {
      if (error.code === '23505' || (error.message && error.message.toLowerCase().includes('unique'))) {
        showJobApplyMessage('Já te candidataste a esta oferta.', true);
        if (applyBtn) {
          applyBtn.innerText = 'Já te candidataste a esta oferta.';
          applyBtn.disabled = true;
        }
      } else {
        showJobApplyMessage(`Não foi possível submeter a candidatura: ${error.message}`, true);
        if (applyBtn) {
          applyBtn.disabled = false;
          applyBtn.innerText = 'Candidate-se agora';
        }
      }
      return;
    }

    // 3. User feedback
    showJobApplyMessage('Candidatura enviada com sucesso.');
    showJobsMessage('Candidatura enviada com sucesso.');

    // 4. Reload job detail view to show confirmed applied status
    await openJobOfferDetail(jobOfferId);

    // 5. Update Candidate panel "Minhas candidaturas"
    await loadMyApplications();

  } catch (err) {
    console.error('Erro ao submeter candidatura:', err);
    showJobApplyMessage(`Erro ao submeter candidatura: ${err.message || 'Tente novamente.'}`, true);
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.innerText = 'Candidate-se agora';
    }
  }
}

function editSelectedJobOffer() {
  if (selectedJobOffer && currentSession?.user?.id === selectedJobOffer.user_id) openJobOfferForm(selectedJobOffer);
}

function closeJobOfferDetail() {
  const detail = document.getElementById('job-offer-detail');
  detail.hidden = true;
  detail.innerHTML = '';
}

async function toggleJobOfferStatus(id, status) {
  if (!currentSession?.user) return;
  const { data, error } = await supabaseClient.from('job_offers').update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', currentSession.user.id).select(JOB_OFFER_FIELDS).single();
  if (error) return showJobsMessage('Não foi possível atualizar o estado da oferta.', true);
  selectedJobOffer = data;
  jobOffers = jobOffers.filter(offer => offer.id !== id);
  if (status === 'open') jobOffers.unshift(data);
  await loadJobProfiles([data]);
  await openJobOfferDetail(id);
  filterJobOffers();
}

async function deleteJobOffer(id) {
  if (!currentSession?.user || !window.confirm('Eliminar esta oferta?')) return;
  const { error } = await supabaseClient.from('job_offers').delete().eq('id', id).eq('user_id', currentSession.user.id);
  if (error) return showJobsMessage('Não foi possível eliminar a oferta.', true);
  closeJobOfferDetail();
  jobOffers = jobOffers.filter(offer => offer.id !== id);
  filterJobOffers();
  showJobsMessage('Oferta eliminada.');
}

// Lista de Produtos do QUINZOWORK
const products = [
  { id: 1, name: 'Serviço de Desenvolvimento Web', price: '2500,00', desc: 'Criação de site completo responsivo.' },
  { id: 2, name: 'Plano Mensal Suporte & Gestão', price: '350,00', desc: 'Manutenção e atualização contínua.' },
  { id: 3, name: 'Consultoria Técnica Digital', price: '150,00', desc: 'Atendimento e orientação de projetos.' }
];

let cartCount = 0;
let skillsSelectorOpen = false;

function loadProducts() {
  const container = document.getElementById('products-list');
  if (!container) return;
  container.innerHTML = products.map(p => `
    <div class="card">
      <h3>${p.name}</h3>
      <p style="margin: 6px 0 12px 0; color: #94a3b8; font-size: 0.88rem;">${p.desc}</p>
      <p style="font-weight: 800; color: #00f2fe; font-size: 1.1rem; margin-bottom: 12px;">KZ ${p.price}</p>
      <button class="btn-primary" onclick="addToCart()">Adicionar ao Carrinho</button>
    </div>
  `).join('');
}

function addToCart() {
  cartCount++;
  document.getElementById('cart-count').innerText = cartCount;
}

function checkout() {
  alert(cartCount > 0 ? 'Pedido iniciado! Redirecionando...' : 'Seu carrinho está vazio.');
}

// Autenticação real com Supabase Auth.
const SUPABASE_URL = 'https://qazdbifnosykdgjufjtc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_IYc8bf1pe2wNG7o4l-Q97Q_hm5-vEBx';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

function showAuthMessage(message, isError = false) {
  const element = document.getElementById('auth-message');
  element.innerText = message;
  element.className = isError ? 'auth-message error' : 'auth-message';
}

const ROLE_LABELS = {
  freelancer: 'Freelancer',
  job_seeker: 'Job Seeker',
  remote_worker: 'Remote Worker',
  creator: 'Creator',
  business: 'Business'
};

let currentSession = null;
let currentProfile = null;
let profileFormSkills = [];
let isCurrentUserAdmin = false;

async function checkAdminAccess() {
  if (!currentSession?.user) {
    isCurrentUserAdmin = false;
    document.getElementById('admin-nav').hidden = true;
    return false;
  }

  const { data, error } = await supabaseClient.rpc('is_admin');
  isCurrentUserAdmin = !error && data === true;
  document.getElementById('admin-nav').hidden = !isCurrentUserAdmin;
  return isCurrentUserAdmin;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'\"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '\"': '&quot;'
  }[character]));
}

function formatAdminDate(value) {
  if (!value) return 'Não informado';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Não informado' : date.toLocaleDateString('pt-BR');
}

function showAdminUsersMessage(message, isError = false) {
  const element = document.getElementById('admin-users-message');
  element.innerText = message;
  element.className = isError ? 'admin-users-message error' : 'admin-users-message';
}

function renderAdminUsers(users) {
  const tbody = document.getElementById('admin-users-body');
  const emptyState = document.getElementById('admin-users-empty');
  const table = document.getElementById('admin-users-table');
  document.getElementById('admin-users-count').innerText = String(users.length);
  tbody.innerHTML = users.map(user => `
    <tr>
      <td data-label="Nome">${escapeHtml(user.full_name || 'Não informado')}</td>
      <td data-label="Email">${escapeHtml(user.email || 'Não informado')}</td>
      <td data-label="Tipo de utilizador">${escapeHtml(ROLE_LABELS[user.user_type] || 'Não informado')}</td>
      <td data-label="Data de criação">${escapeHtml(formatAdminDate(user.created_at))}</td>
      <td data-label="Estado"><span class="status-active">Ativo</span></td>
    </tr>
  `).join('');
  table.hidden = users.length === 0;
  emptyState.hidden = users.length !== 0;
}

async function loadAdminUsers() {
  const allowed = await checkAdminAccess();
  if (!allowed) {
    document.getElementById('admin-users-view').hidden = true;
    return;
  }

  const refreshButton = document.getElementById('admin-users-refresh');
  const loading = document.getElementById('admin-users-loading');
  refreshButton.disabled = true;
  loading.hidden = false;
  showAdminUsersMessage('');

  const { data, error } = await supabaseClient.rpc('admin_list_users');
  refreshButton.disabled = false;
  loading.hidden = true;

  if (error) {
    renderAdminUsers([]);
    showAdminUsersMessage(`Não foi possível carregar os utilizadores: ${error.message}`, true);
    return;
  }

  renderAdminUsers(Array.isArray(data) ? data : []);
  showAdminUsersMessage('Utilizadores carregados com segurança.');
}

function openAdminUsers() {
  document.getElementById('admin-users-view').hidden = false;
  loadAdminUsers();
}

function showAdminProfilesMessage(message, isError = false) {
  const element = document.getElementById('admin-profiles-message');
  element.innerText = message;
  element.className = isError ? 'admin-users-message error' : 'admin-users-message';
}

function renderAdminProfiles(profiles) {
  const tbody = document.getElementById('admin-profiles-body');
  const emptyState = document.getElementById('admin-profiles-empty');
  const table = document.getElementById('admin-profiles-table');
  document.getElementById('admin-profiles-count').innerText = String(profiles.length);
  tbody.innerHTML = profiles.map(profile => `
    <tr>
      <td data-label="ID do utilizador"><code>${escapeHtml(profile.user_id || 'Não informado')}</code></td>
      <td data-label="Nome completo">${escapeHtml(profile.full_name || 'Não informado')}</td>
      <td data-label="Tipo de utilizador">${escapeHtml(ROLE_LABELS[profile.user_type] || 'Não informado')}</td>
      <td data-label="Avatar">${profile.avatar_url ? '<span class="status-active">Disponível</span>' : 'Não informado'}</td>
      <td data-label="Data de criação">${escapeHtml(formatAdminDate(profile.created_at))}</td>
  <td data-label="Última atualização">${escapeHtml(formatAdminDate(profile.updated_at))}</td>
  <td data-label="Perfil público"><button class="btn-secondary admin-profile-link" type="button" onclick="openPublicProfile('${escapeHtml(profile.user_id || profile.id || '')}')" ${profile.user_id || profile.id ? '' : 'disabled'}>Ver perfil</button></td>
  </tr>
  `).join('');
  table.hidden = profiles.length === 0;
  emptyState.hidden = profiles.length !== 0;
}

async function loadAdminProfiles() {
  const allowed = await checkAdminAccess();
  if (!allowed) {
    document.getElementById('admin-profiles-view').hidden = true;
    return;
  }

  const refreshButton = document.getElementById('admin-profiles-refresh');
  const loading = document.getElementById('admin-profiles-loading');
  refreshButton.disabled = true;
  loading.hidden = false;
  showAdminProfilesMessage('');

  const { data, error } = await supabaseClient.rpc('admin_list_profiles');
  refreshButton.disabled = false;
  loading.hidden = true;

  if (error) {
    renderAdminProfiles([]);
    showAdminProfilesMessage(`Não foi possível carregar os perfis: ${error.message}`, true);
    return;
  }

  renderAdminProfiles(Array.isArray(data) ? data : []);
  showAdminProfilesMessage('Perfis carregados com segurança.');
}

function openAdminProfiles() {
  document.getElementById('admin-profiles-view').hidden = false;
  loadAdminProfiles();
}

function showAdminPlatformMessage(message, isError = false) {
  const element = document.getElementById('admin-platform-message');
  element.innerText = message;
  element.className = isError ? 'admin-users-message error' : 'admin-users-message';
}

function renderAdminPlatformStatus(status) {
  const checks = [
    ['admin-platform-authentication', status.authentication_status],
    ['admin-platform-database', status.database_status],
    ['admin-platform-api', status.admin_api_status]
  ];

  checks.forEach(([id, value]) => {
    const element = document.getElementById(id);
    const operational = value === 'Operacional';
    element.innerText = operational ? 'Operacional' : 'Problema detectado';
    element.className = `admin-platform-status ${operational ? 'operational' : 'problem'}`;
  });

  document.getElementById('admin-platform-users').innerText = String(Number(status.total_users) || 0);
  document.getElementById('admin-platform-profiles').innerText = String(Number(status.total_profiles) || 0);
  document.getElementById('admin-platform-checked').innerText = formatAdminDateTime(status.checked_at);
}

async function loadAdminPlatformStatus() {
  const allowed = await checkAdminAccess();
  if (!allowed) {
    document.getElementById('admin-platform-view').hidden = true;
    return;
  }

  const refreshButton = document.getElementById('admin-platform-refresh');
  const loading = document.getElementById('admin-platform-loading');
  refreshButton.disabled = true;
  loading.hidden = false;
  showAdminPlatformMessage('');

  const { data, error } = await supabaseClient.rpc('admin_platform_status');
  refreshButton.disabled = false;
  loading.hidden = true;

  if (error) {
    showAdminPlatformMessage(`Não foi possível verificar a plataforma: ${error.message}`, true);
    return;
  }

  const status = Array.isArray(data) ? data[0] : data;
  if (!status) {
    showAdminPlatformMessage('Nenhum estado da plataforma foi retornado.', true);
    return;
  }

  renderAdminPlatformStatus(status);
  showAdminPlatformMessage('Verificação concluída com segurança.');
}

function openAdminPlatform() {
  document.getElementById('admin-platform-view').hidden = false;
  loadAdminPlatformStatus();
}

function showAdminDashboardMessage(message, isError = false) {
  const element = document.getElementById('admin-dashboard-message');
  element.innerText = message;
  element.className = isError ? 'admin-users-message error' : 'admin-users-message';
}

function formatAdminDateTime(value) {
  if (!value) return 'Não informado';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Não informado' : date.toLocaleString('pt-BR');
}

function renderAdminDashboard(stats) {
  const values = {
    'total-users': stats.total_users,
    'total-profiles': stats.total_profiles,
    freelancers: stats.freelancers,
    'job-seekers': stats.job_seekers,
    'remote-workers': stats.remote_workers,
    creators: stats.creators,
    businesses: stats.businesses,
    'recent-users': stats.recent_users
  };
  Object.entries(values).forEach(([id, value]) => {
    document.getElementById(`admin-stat-${id}`).innerText = String(Number(value) || 0);
  });
}

async function loadAdminDashboard() {
  const allowed = await checkAdminAccess();
  if (!allowed) {
    document.getElementById('admin-dashboard-view').hidden = true;
    return;
  }

  const refreshButton = document.getElementById('admin-dashboard-refresh');
  const loading = document.getElementById('admin-dashboard-loading');
  refreshButton.disabled = true;
  loading.hidden = false;
  showAdminDashboardMessage('');

  const { data, error } = await supabaseClient.rpc('admin_dashboard_stats');
  refreshButton.disabled = false;
  loading.hidden = true;

  if (error) {
    showAdminDashboardMessage(`Não foi possível carregar o dashboard: ${error.message}`, true);
    return;
  }

  const stats = Array.isArray(data) ? data[0] : data;
  if (!stats) {
    showAdminDashboardMessage('Nenhum dado administrativo encontrado.', true);
    return;
  }

  renderAdminDashboard(stats);
  document.getElementById('admin-dashboard-updated').innerText = `Última atualização: ${formatAdminDateTime(new Date())}`;
  showAdminDashboardMessage('Dados administrativos carregados com segurança.');
}

function openAdminDashboard() {
  document.getElementById('admin-dashboard-view').hidden = false;
  loadAdminDashboard();
}

function updateAuthInterface(session) {
  const isAuthenticated = Boolean(session?.user);
  currentSession = session;
  document.getElementById('auth-box').style.display = isAuthenticated ? 'none' : 'block';
  document.getElementById('dashboard').style.display = isAuthenticated ? 'block' : 'none';

  if (!isAuthenticated) {
    currentProfile = null;
    isCurrentUserAdmin = false;
    document.getElementById('admin-nav').hidden = true;
    document.getElementById('admin-panel').hidden = true;
    showAuthMessage('');
    clearCandidateApplications();
    clearEmployerOffers();
    return;
  }

  document.getElementById('profile-email').innerText = session.user.email || '';
  const metadataName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || '';
  const profile = currentProfile || {};
  document.getElementById('profile-name').innerText = profile.full_name || metadataName || 'Ainda não informado';
  document.getElementById('profile-role').innerText = ROLE_LABELS[profile.role] || 'Ainda não informado';
  document.getElementById('profile-display-title').innerText = profile.professional_title || 'Ainda não informado';
  document.getElementById('profile-display-location').innerText = profile.location || 'Ainda não informado';
  document.getElementById('profile-display-bio').innerText = profile.bio || 'Ainda não informado';
  document.getElementById('profile-display-experience').innerText = profile.experience || 'Ainda não informado';
  document.getElementById('profile-display-education').innerText = profile.education || 'Ainda não informado';
  document.getElementById('profile-display-availability').innerText = profile.availability || 'Ainda não informado';
  document.getElementById('profile-display-hourly-rate').innerText = profile.hourly_rate === null || profile.hourly_rate === undefined || profile.hourly_rate === '' ? 'Ainda não informado' : `KZ ${profile.hourly_rate}/hora`;
  document.getElementById('profile-display-phone').innerText = profile.phone || 'Ainda não informado';
  document.getElementById('profile-display-website').innerText = profile.website_url || 'Ainda não informado';
  document.getElementById('profile-display-linkedin').innerText = profile.linkedin_url || 'Ainda não informado';
  const skills = Array.isArray(profile.skills) ? profile.skills : [];
  document.getElementById('profile-display-skills').innerText = skills.length ? skills.join(' · ') : 'Ainda não informado';
  updateProfileAvatar(profile.avatar_url);

  const isBusiness = profile.role === 'business';
  const employerSection = document.getElementById('my-job-offers-section');
  const candidateSection = document.getElementById('my-applications-section');

  if (employerSection) {
    employerSection.hidden = !isBusiness;
  }
  if (candidateSection) {
    candidateSection.hidden = isBusiness;
  }

  if (isBusiness) {
    loadEmployerOffers();
  } else {
    loadMyApplications();
  }
}

let candidateApplications = [];
let candidateJobsMap = {};
let candidatePublishersMap = {};

function formatJobDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data não informada';
  return `${date.toLocaleDateString('pt-BR')} às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function clearCandidateApplications() {
  candidateApplications = [];
  candidateJobsMap = {};
  candidatePublishersMap = {};
  const listEl = document.getElementById('my-applications-list');
  const emptyEl = document.getElementById('my-applications-empty');
  const messageEl = document.getElementById('my-applications-message');
  const loadingEl = document.getElementById('my-applications-loading');
  if (listEl) listEl.innerHTML = '';
  if (emptyEl) emptyEl.hidden = true;
  if (messageEl) messageEl.innerText = '';
  if (loadingEl) loadingEl.hidden = true;
  closeApplicationDetailModal();
}

async function loadMyApplications() {
  if (!currentSession?.user) {
    clearCandidateApplications();
    return;
  }

  const listEl = document.getElementById('my-applications-list');
  const emptyEl = document.getElementById('my-applications-empty');
  const loadingEl = document.getElementById('my-applications-loading');
  const messageEl = document.getElementById('my-applications-message');

  if (!listEl) return;
  if (loadingEl) loadingEl.hidden = false;
  if (emptyEl) emptyEl.hidden = true;
  if (messageEl) messageEl.innerText = '';

  try {
    const { data: apps, error } = await supabaseClient
      .from('applications')
      .select('id, job_id, status, cover_letter, created_at, updated_at')
      .eq('applicant_id', currentSession.user.id)
      .order('created_at', { ascending: false });

    if (loadingEl) loadingEl.hidden = true;

    if (error) {
      if (messageEl) {
        messageEl.innerText = `Não foi possível carregar as candidaturas: ${error.message}`;
        messageEl.className = 'jobs-message error';
      }
      return;
    }

    candidateApplications = apps || [];

    if (candidateApplications.length === 0) {
      if (emptyEl) emptyEl.hidden = false;
      if (listEl) listEl.innerHTML = '';
      return;
    }

    if (emptyEl) emptyEl.hidden = true;

    // Collect job details for each application
    const jobIds = [...new Set(candidateApplications.map(a => a.job_id).filter(Boolean))];
    let jobsMap = {};
    let publishersMap = {};

    if (jobIds.length > 0) {
      const { data: jobsData } = await supabaseClient
        .from('job_offers')
        .select('id, title, category, work_type, location, budget, payment_type, status, user_id, created_at')
        .in('id', jobIds);

      if (jobsData) {
        jobsMap = Object.fromEntries(jobsData.map(j => [j.id, j]));
        const publisherIds = [...new Set(jobsData.map(j => j.user_id).filter(Boolean))];
        if (publisherIds.length > 0) {
          const { data: profs } = await supabaseClient
            .from('profiles')
            .select('id, full_name, avatar_url')
            .in('id', publisherIds);
          if (profs) {
            publishersMap = Object.fromEntries(profs.map(p => [p.id, p]));
          }
        }
      }
    }

    candidateJobsMap = jobsMap;
    candidatePublishersMap = publishersMap;

    renderCandidateApplications(candidateApplications, jobsMap, publishersMap);
  } catch (err) {
    if (loadingEl) loadingEl.hidden = true;
    console.error('Erro ao carregar candidaturas:', err);
    if (messageEl) {
      messageEl.innerText = 'Erro ao carregar as candidaturas.';
      messageEl.className = 'jobs-message error';
    }
  }
}

function renderCandidateApplications(apps, jobsMap, publishersMap) {
  const listEl = document.getElementById('my-applications-list');
  if (!listEl) return;

  const statusLabels = {
    pending: 'Pendente',
    reviewed: 'Em análise',
    accepted: 'Aceite',
    rejected: 'Não selecionado'
  };

  listEl.innerHTML = apps.map(app => {
    const job = jobsMap[app.job_id] || null;
    const publisher = job ? (publishersMap[job.user_id] || null) : null;
    const jobTitle = job ? job.title : 'Oferta de trabalho';
    const companyName = publisher?.full_name ? publisher.full_name : (job ? 'Empresa / Anunciante' : 'Não disponível');
    const appDate = formatJobDate(app.created_at);
    const statusText = statusLabels[app.status] || (app.status === 'pending' ? 'Pendente' : app.status);
    const statusClass = `status-${app.status || 'pending'}`;

    return `
      <article class="my-application-item clickable" id="application-${escapeHtml(app.id)}" onclick="openApplicationDetailModal('${escapeHtml(app.id)}')">
        <div class="my-application-header">
          <div>
            <span class="my-application-category">${job?.category ? escapeHtml(job.category) : 'Oportunidade'}</span>
            <h4 class="my-application-title">${escapeHtml(jobTitle)}</h4>
            <p class="my-application-company">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
              ${escapeHtml(companyName)}
            </p>
          </div>
          <div class="my-application-badge-wrap">
            <span class="status-pill ${statusClass}">${escapeHtml(statusText)}</span>
          </div>
        </div>
        <div class="my-application-footer">
          <span class="my-application-date">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            Candidatura enviada em: ${escapeHtml(appDate)}
          </span>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn-secondary btn-app-details" type="button" onclick="event.stopPropagation(); openApplicationDetailModal('${escapeHtml(app.id)}')">Ver detalhes & notas</button>
            ${job ? `<button class="btn-secondary btn-view-applied-job" type="button" onclick="event.stopPropagation(); viewAppliedJobOffer('${escapeHtml(job.id)}')">Ver oferta</button>` : ''}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function openApplicationDetailModal(appId) {
  const app = candidateApplications.find(a => a.id === appId);
  const modalEl = document.getElementById('application-detail-modal');
  const titleEl = document.getElementById('app-modal-title');
  const subtitleEl = document.getElementById('app-modal-subtitle');
  const bodyEl = document.getElementById('app-modal-body');

  if (!modalEl || !bodyEl) return;
  if (!app) {
    console.warn('Candidatura não encontrada:', appId);
    return;
  }

  const job = candidateJobsMap[app.job_id] || null;
  const publisher = job ? (candidatePublishersMap[job.user_id] || null) : null;
  const jobTitle = job ? job.title : 'Oferta de trabalho';
  const companyName = publisher?.full_name ? publisher.full_name : (job ? 'Empresa / Anunciante' : 'Não disponível');

  if (titleEl) titleEl.innerText = jobTitle;
  if (subtitleEl) {
    const subtitleParts = [companyName];
    if (job?.category) subtitleParts.push(job.category);
    if (job?.work_type) subtitleParts.push(job.work_type);
    subtitleEl.innerText = subtitleParts.join(' · ');
  }

  const statusLabels = {
    pending: 'Pendente',
    reviewed: 'Em análise',
    accepted: 'Aceite',
    rejected: 'Não selecionado'
  };

  const statusDescriptions = {
    pending: 'A sua candidatura foi submetida com sucesso e aguarda análise inicial por parte da entidade anunciante.',
    reviewed: 'O seu perfil profissional e candidatura foram visualizados e encontram-se atualmente em fase de avaliação.',
    accepted: 'Parabéns! A sua candidatura foi aceite. A empresa entrará em contacto consigo para as próximas fases.',
    rejected: 'O anunciante concluiu o processo de seleção e optou por avançar com outro perfil para esta vaga.'
  };

  const currentStatus = app.status || 'pending';
  const statusText = statusLabels[currentStatus] || currentStatus;
  const statusDesc = statusDescriptions[currentStatus] || 'Estado da candidatura em acompanhamento.';

  // Timeline Step Classes
  const step1Class = 'completed'; // Submission always done
  let step2Class = '';
  let step3Class = '';

  if (currentStatus === 'reviewed') {
    step2Class = 'current';
  } else if (currentStatus === 'accepted' || currentStatus === 'rejected') {
    step2Class = 'completed';
    step3Class = currentStatus === 'accepted' ? 'completed' : 'rejected';
  }

  const step2Text = currentStatus === 'pending' ? 'Em espera' : (currentStatus === 'reviewed' ? 'Em curso' : 'Concluída');
  const step3Text = currentStatus === 'accepted' ? 'Aceite' : (currentStatus === 'rejected' ? 'Não selecionado' : 'Aguardando');

  // Read saved notes (cover letter or local cache)
  const savedNotes = app.cover_letter || localStorage.getItem(`quinzowork_app_notes_${app.id}`) || '';

  const submissionDateFormatted = formatJobDateTime(app.created_at);
  const updatedDateFormatted = app.updated_at ? formatJobDateTime(app.updated_at) : submissionDateFormatted;

  bodyEl.innerHTML = `
    <!-- HISTÓRICO E LINHA DO TEMPO -->
    <div class="app-status-tracker">
      <div class="app-status-tracker-header">
        <strong>Histórico e Estado da Submissão</strong>
        <span class="status-pill status-${escapeHtml(currentStatus)}">${escapeHtml(statusText)}</span>
      </div>

      <div class="app-timeline-steps">
        <div class="app-timeline-step ${step1Class}">
          <div class="app-timeline-dot">✓</div>
          <span class="app-timeline-label">1. Submetida<br><small style="color: #67e8f9;">Concluída</small></span>
        </div>
        <div class="app-timeline-step ${step2Class}">
          <div class="app-timeline-dot">${currentStatus === 'reviewed' ? '●' : (step2Class === 'completed' ? '✓' : '2')}</div>
          <span class="app-timeline-label">2. Avaliação<br><small>${escapeHtml(step2Text)}</small></span>
        </div>
        <div class="app-timeline-step ${step3Class}">
          <div class="app-timeline-dot">${currentStatus === 'accepted' ? '✓' : (currentStatus === 'rejected' ? '✕' : '3')}</div>
          <span class="app-timeline-label">3. Decisão<br><small>${escapeHtml(step3Text)}</small></span>
        </div>
      </div>

      <div class="app-timeline-meta">
        ${escapeHtml(statusDesc)}
      </div>

      <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 0.78rem; color: #94a3b8; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px;">
        <span><strong>Data de envio:</strong> ${escapeHtml(submissionDateFormatted)}</span>
        <span id="app-modal-updated-at"><strong>Última atualização:</strong> ${escapeHtml(updatedDateFormatted)}</span>
      </div>
    </div>

    <!-- RESUMO DA VAGA -->
    <div class="app-detail-summary">
      <div>
        <span>Modalidade</span>
        <p>${job ? escapeHtml(job.work_type || 'Não informado') : 'Não disponível'}</p>
      </div>
      <div>
        <span>Localização</span>
        <p>${job ? escapeHtml(job.location || 'Não informado') : 'Não disponível'}</p>
      </div>
      <div>
        <span>Remuneração / Orçamento</span>
        <p>${job ? escapeHtml(formatJobBudget(job.budget, job.payment_type)) : 'Não disponível'}</p>
      </div>
      <div>
        <span>Estado da Vaga</span>
        <p>${job ? (job.status === 'open' ? 'Aberta para candidaturas' : 'Oferta encerrada') : 'Não disponível'}</p>
      </div>
    </div>

    <!-- NOTAS E HISTÓRICO DE SUBMISSÃO -->
    <div class="app-notes-section">
      <div class="app-notes-header">
        <strong>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          Notas e Carta de Apresentação
        </strong>
      </div>
      <p class="app-notes-desc">
        Anotações pessoais, carta enviada ou notas de acompanhamento sobre esta oportunidade.
      </p>
      <textarea id="app-modal-notes-input" class="app-notes-textarea" placeholder="Ex: Enviei o link do GitHub; entrevista técnica pré-agendada; contacto direto com o recrutador..." maxlength="2000">${escapeHtml(savedNotes)}</textarea>
      <div class="app-notes-actions">
        <p id="app-modal-notes-msg" class="jobs-message" role="status" aria-live="polite" style="margin: 0;"></p>
        <button type="button" class="btn-primary" id="app-modal-notes-save-btn" onclick="saveApplicationNotes('${escapeHtml(app.id)}')">Guardar notas</button>
      </div>
    </div>

    <!-- RODAPÉ DO MODAL -->
    <div class="app-modal-footer">
      <button type="button" class="btn-secondary" onclick="closeApplicationDetailModal()">Fechar</button>
      ${job ? `<button type="button" class="btn-primary" onclick="closeApplicationDetailModal(); viewAppliedJobOffer('${escapeHtml(job.id)}')">Ver Oferta Completa</button>` : ''}
    </div>
  `;

  modalEl.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeApplicationDetailModal() {
  const modalEl = document.getElementById('application-detail-modal');
  if (modalEl) modalEl.hidden = true;
  document.body.style.overflow = '';
}

function handleAppModalOverlayClick(event) {
  if (event.target && event.target.id === 'application-detail-modal') {
    closeApplicationDetailModal();
  }
}

async function saveApplicationNotes(appId) {
  const notesTextarea = document.getElementById('app-modal-notes-input');
  const saveBtn = document.getElementById('app-modal-notes-save-btn');
  const msgEl = document.getElementById('app-modal-notes-msg');
  if (!notesTextarea) return;

  const newNotes = notesTextarea.value.trim();
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerText = 'A guardar...';
  }
  if (msgEl) {
    msgEl.innerText = '';
    msgEl.className = 'jobs-message';
  }

  const nowIso = new Date().toISOString();

  try {
    const { error } = await supabaseClient
      .from('applications')
      .update({
        cover_letter: newNotes,
        updated_at: nowIso
      })
      .eq('id', appId)
      .eq('applicant_id', currentSession.user.id);

    // Also persist in localStorage for instant retrieval
    try {
      localStorage.setItem(`quinzowork_app_notes_${appId}`, newNotes);
    } catch (_) {}

    // Update in-memory record
    const appItem = candidateApplications.find(a => a.id === appId);
    if (appItem) {
      appItem.cover_letter = newNotes;
      appItem.updated_at = nowIso;
    }

    if (error) {
      console.warn('Aviso ao atualizar notas no Supabase, guardado localmente:', error);
      if (msgEl) {
        msgEl.innerText = 'Notas guardadas com sucesso!';
        msgEl.className = 'jobs-message success';
      }
    } else {
      if (msgEl) {
        msgEl.innerText = 'Notas guardadas com sucesso!';
        msgEl.className = 'jobs-message success';
      }
    }

    const updatedEl = document.getElementById('app-modal-updated-at');
    if (updatedEl) {
      updatedEl.innerText = `Última atualização: ${formatJobDateTime(nowIso)}`;
    }

    setTimeout(() => {
      if (msgEl && msgEl.innerText.includes('sucesso')) {
        msgEl.innerText = '';
      }
    }, 4000);
  } catch (err) {
    console.error('Erro ao guardar notas:', err);
    try {
      localStorage.setItem(`quinzowork_app_notes_${appId}`, newNotes);
      if (msgEl) {
        msgEl.innerText = 'Notas guardadas localmente!';
        msgEl.className = 'jobs-message success';
      }
    } catch (_) {
      if (msgEl) {
        msgEl.innerText = 'Erro ao guardar notas.';
        msgEl.className = 'jobs-message error';
      }
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerText = 'Guardar notas';
    }
  }
}

// Fechar modal ao pressionar a tecla Escape
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const modalEl = document.getElementById('application-detail-modal');
    if (modalEl && !modalEl.hidden) {
      closeApplicationDetailModal();
    }
  }
});

function viewAppliedJobOffer(jobId) {
  openJobOffers();
  openJobOfferDetail(jobId);
}

// ============================================================================
// FASE 2: GESTÃO DE CANDIDATOS PARA EMPREGADORES / BUSINESS
// ============================================================================

let employerOffers = [];
let employerAppCounts = {};

function clearEmployerOffers() {
  employerOffers = [];
  employerAppCounts = {};
  const listEl = document.getElementById('my-job-offers-list');
  const emptyEl = document.getElementById('my-job-offers-empty');
  const messageEl = document.getElementById('my-job-offers-message');
  const loadingEl = document.getElementById('my-job-offers-loading');
  if (listEl) listEl.innerHTML = '';
  if (emptyEl) emptyEl.hidden = true;
  if (messageEl) messageEl.innerText = '';
  if (loadingEl) loadingEl.hidden = true;
}

async function loadEmployerOffers() {
  if (!currentSession?.user) {
    clearEmployerOffers();
    return;
  }

  const listEl = document.getElementById('my-job-offers-list');
  const emptyEl = document.getElementById('my-job-offers-empty');
  const loadingEl = document.getElementById('my-job-offers-loading');
  const messageEl = document.getElementById('my-job-offers-message');

  if (!listEl) return;
  if (loadingEl) loadingEl.hidden = false;
  if (emptyEl) emptyEl.hidden = true;
  if (messageEl) messageEl.innerText = '';

  try {
    const { data: offers, error } = await supabaseClient
      .from('job_offers')
      .select('id, title, category, work_type, location, budget, payment_type, status, created_at')
      .eq('user_id', currentSession.user.id)
      .order('created_at', { ascending: false });

    if (loadingEl) loadingEl.hidden = true;

    if (error) {
      if (messageEl) {
        messageEl.innerText = `Não foi possível carregar as suas ofertas: ${error.message}`;
        messageEl.className = 'jobs-message error';
      }
      return;
    }

    employerOffers = offers || [];

    if (employerOffers.length === 0) {
      if (emptyEl) emptyEl.hidden = false;
      listEl.innerHTML = '';
      return;
    }

    const offerIds = employerOffers.map(o => o.id);
    let appCounts = {};
    if (offerIds.length > 0) {
      try {
        const { data: appsData, error: appsErr } = await supabaseClient
          .from('applications')
          .select('id, job_id')
          .in('job_id', offerIds);

        if (!appsErr && appsData) {
          appsData.forEach(a => {
            appCounts[a.job_id] = (appCounts[a.job_id] || 0) + 1;
          });
        }
      } catch (countErr) {
        console.warn('Erro ao contar candidaturas:', countErr);
      }
    }
    employerAppCounts = appCounts;

    renderEmployerOffers(employerOffers, employerAppCounts);
  } catch (err) {
    if (loadingEl) loadingEl.hidden = true;
    console.error('Erro ao carregar ofertas do empregador:', err);
    if (messageEl) {
      messageEl.innerText = 'Erro inesperado ao carregar ofertas.';
      messageEl.className = 'jobs-message error';
    }
  }
}

function renderEmployerOffers(offers, appCounts) {
  const listEl = document.getElementById('my-job-offers-list');
  if (!listEl) return;

  listEl.innerHTML = offers.map(offer => {
    const count = appCounts[offer.id] || 0;
    const isClosed = offer.status !== 'open';
    const statusClass = isClosed ? 'status-rejected' : 'status-accepted';
    const statusText = isClosed ? 'Encerrada' : 'Aberta';
    const createdFormatted = formatJobDate(offer.created_at);

    return `
      <article class="my-job-offer-item" id="employer-offer-${escapeHtml(offer.id)}">
        <div class="my-job-offer-header">
          <div>
            <span class="my-job-offer-category">${offer.category ? escapeHtml(offer.category) : 'Oportunidade'}</span>
            <h4 class="my-job-offer-title">${escapeHtml(offer.title)}</h4>
          </div>
          <div class="my-job-offer-badges">
            <span class="candidate-counter-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              Candidatos: <strong>${count}</strong>
            </span>
            <span class="status-pill ${statusClass}">${statusText}</span>
          </div>
        </div>
        <div class="my-job-offer-footer">
          <span class="my-job-offer-meta">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            Publicada em: ${escapeHtml(createdFormatted)}
            ${offer.location ? `· ${escapeHtml(offer.location)}` : ''}
          </span>
          <button class="btn-primary" type="button" onclick="openEmployerOfferDetail('${escapeHtml(offer.id)}')">Ver oferta & candidatos</button>
        </div>
      </article>
    `;
  }).join('');
}

function openEmployerOfferDetail(jobOfferId) {
  openJobOffers();
  openJobOfferDetail(jobOfferId);
}

async function loadJobCandidates(jobOfferId) {
  const container = document.getElementById('candidates-container');
  const countBadge = document.getElementById('candidates-count-badge');
  const messageEl = document.getElementById('candidates-message');

  // Camada 1 de Verificação de Segurança no Cliente: Utilizador autenticado
  const currentUserId = currentSession?.user?.id;
  if (!currentUserId) {
    if (container) {
      container.innerHTML = '<p class="jobs-message error">Inicie sessão para visualizar os candidatos desta oferta.</p>';
    }
    if (countBadge) countBadge.innerText = '(0)';
    return;
  }

  if (!container) return;
  container.innerHTML = '<p class="jobs-loading">A verificar permissões e a carregar candidaturas...</p>';
  if (messageEl) messageEl.innerText = '';

  // Camada 2 de Verificação de Segurança no Cliente: Confirmação estrita de propriedade da vaga
  // Garante que o anunciante autenticado é o legítimo proprietário antes de fazer qualquer pedido a 'applications'
  let isVerifiedOwner = false;

  // 1. Verificação rápida em cache local (se já tiver sido carregada em employerOffers)
  const localOffer = Array.isArray(employerOffers) ? employerOffers.find(o => o.id === jobOfferId) : null;
  if (localOffer && localOffer.user_id === currentUserId) {
    isVerifiedOwner = true;
  }

  // 2. Verificação autoritativa consultando a tabela 'job_offers'
  try {
    const { data: job, error: jobErr } = await supabaseClient
      .from('job_offers')
      .select('id, user_id, title')
      .eq('id', jobOfferId)
      .maybeSingle();

    if (jobErr || !job) {
      console.warn('[Segurança] Oferta de trabalho não encontrada ou erro de leitura:', jobErr);
      container.innerHTML = '<p class="jobs-message error">Não foi possível validar os dados da oferta de trabalho.</p>';
      if (countBadge) countBadge.innerText = '(0)';
      return;
    }

    if (job.user_id !== currentUserId) {
      console.warn(`[Segurança] Bloqueio preventivo no cliente: O utilizador ${currentUserId} tentou aceder a candidatos da vaga ${jobOfferId} pertencente a ${job.user_id}.`);
      container.innerHTML = '<p class="jobs-message error">Acesso negado: apenas o proprietário da oferta de trabalho pode consultar os respetivos candidatos.</p>';
      if (countBadge) countBadge.innerText = '(0)';
      return;
    }

    isVerifiedOwner = true;
  } catch (verifyErr) {
    console.error('[Segurança] Exceção durante a verificação de propriedade da oferta:', verifyErr);
    container.innerHTML = '<p class="jobs-message error">Ocorreu um erro ao validar a titularidade da oferta.</p>';
    if (countBadge) countBadge.innerText = '(0)';
    return;
  }

  if (!isVerifiedOwner) {
    container.innerHTML = '<p class="jobs-message error">Acesso negado: titularidade da oferta não confirmada.</p>';
    if (countBadge) countBadge.innerText = '(0)';
    return;
  }

  // Camada 3: Consulta autorizada às candidaturas submetidas para esta oferta específica
  const { data: applications, error: appErr } = await supabaseClient
    .from('applications')
    .select('id, job_id, applicant_id, status, cover_letter, created_at, updated_at')
    .eq('job_id', jobOfferId)
    .order('created_at', { ascending: false });

  if (appErr) {
    console.error('Erro ao consultar candidaturas:', appErr);
    container.innerHTML = `<p class="jobs-message error">Não foi possível carregar os candidatos: ${escapeHtml(appErr.message)}</p>`;
    if (countBadge) countBadge.innerText = '(0)';
    return;
  }

  const list = applications || [];
  if (countBadge) {
    countBadge.innerText = `(${list.length})`;
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="candidates-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
        <p>Ainda não foram submetidas candidaturas para esta oferta de trabalho.</p>
      </div>
    `;
    return;
  }

  // Buscar informacoes de perfil publico dos candidatos
  const applicantIds = [...new Set(list.map(a => a.applicant_id).filter(Boolean))];
  let profilesMap = {};
  if (applicantIds.length > 0) {
    try {
      const { data: profilesData } = await supabaseClient
        .from('profiles')
        .select('id, full_name, avatar_url, role, professional_title, location')
        .in('id', applicantIds);
      if (profilesData) {
        profilesMap = Object.fromEntries(profilesData.map(p => [p.id, p]));
      }
    } catch (err) {
      console.warn('Erro ao carregar perfis dos candidatos:', err);
    }
  }

  renderJobCandidates(list, profilesMap);
}

function renderJobCandidates(applications, profilesMap) {
  const container = document.getElementById('candidates-container');
  if (!container) return;

  const statusLabels = {
    pending: 'Pendente',
    reviewed: 'Em análise',
    accepted: 'Aceite',
    rejected: 'Não selecionado'
  };

  const cardsHtml = applications.map(app => {
    const profile = profilesMap[app.applicant_id] || null;
    const candidateName = profile?.full_name ? escapeHtml(profile.full_name) : 'Candidato';
    const candidateRole = profile?.role ? (ROLE_LABELS[profile.role] || escapeHtml(profile.role)) : (profile?.professional_title ? escapeHtml(profile.professional_title) : 'Candidato');
    const avatarHtml = profile?.avatar_url
      ? `<img src="${escapeHtml(profile.avatar_url)}" alt="${candidateName}">`
      : escapeHtml(candidateName.charAt(0).toUpperCase() || 'C');

    const appDate = formatJobDate(app.created_at);
    const statusKey = app.status || 'pending';
    const statusText = statusLabels[statusKey] || (statusKey === 'pending' ? 'Pendente' : statusKey);
    const statusClass = `status-${statusKey}`;

    const notesHtml = app.cover_letter ? `
      <div class="candidate-notes-box">
        <strong>Mensagem / Apresentação do Candidato:</strong>
        <p>${escapeHtml(app.cover_letter)}</p>
      </div>
    ` : '';

    return `
      <article class="candidate-card" id="candidate-app-${escapeHtml(app.id)}">
        <div class="candidate-card-top">
          <div class="candidate-card-profile">
            <div class="candidate-avatar">
              ${avatarHtml}
            </div>
            <div class="candidate-name-info">
              <span class="candidate-name">${candidateName}</span>
              <span class="candidate-type-badge">Perfil: <strong class="role-tag">${candidateRole}</strong></span>
            </div>
          </div>
          <div class="candidate-card-meta">
            <span class="status-pill ${statusClass}">${escapeHtml(statusText)}</span>
          </div>
        </div>

        ${notesHtml}

        <div class="candidate-card-bottom">
          <span class="candidate-applied-date">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            Candidatura recebida em: ${escapeHtml(appDate)}
          </span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="candidate-readonly-notice">Somente leitura</span>
            <button class="btn-secondary" type="button" onclick="openPublicProfile('${escapeHtml(app.applicant_id)}')">Ver perfil</button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  container.innerHTML = `<div class="candidates-list">${cardsHtml}</div>`;
}

// Alias de conveniência para loadJobCandidates
const loadCandidates = loadJobCandidates;
window.loadCandidates = loadJobCandidates;

function updateProfileAvatar(url) {
  const avatar = document.getElementById('profile-avatar');
  const placeholder = document.getElementById('profile-avatar-placeholder');
  avatar.hidden = !url;
  placeholder.hidden = Boolean(url);
  if (url) avatar.src = url;
}

function openAvatarPicker() {
  if (!currentSession?.user) return;
  document.getElementById('profile-avatar-input').click();
}

async function handleAvatarSelection(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !currentSession?.user) return;

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    showProfileMessage('Escolha uma imagem JPG, PNG ou WebP.', true);
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showProfileMessage('A imagem deve ter no máximo 5 MB.', true);
    return;
  }

  const previewUrl = URL.createObjectURL(file);
  updateProfileAvatar(previewUrl);
  const avatarButton = document.getElementById('profile-avatar-button');
  const changeButton = document.getElementById('profile-avatar-change');
  avatarButton.disabled = true;
  changeButton.disabled = true;
  showProfileMessage('Enviando...');

  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const filePath = `${currentSession.user.id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabaseClient.storage
    .from('avatares')
    .upload(filePath, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    avatarButton.disabled = false;
    changeButton.disabled = false;
    showProfileMessage(`Não foi possível enviar a foto: ${uploadError.message}`, true);
    return;
  }

  const { data: publicUrlData } = supabaseClient.storage.from('avatares').getPublicUrl(filePath);
  const avatarUrl = publicUrlData?.publicUrl;
  if (!avatarUrl) {
    avatarButton.disabled = false;
    changeButton.disabled = false;
    showProfileMessage('Não foi possível obter o endereço da foto.', true);
    return;
  }

  const { data, error: profileError } = await supabaseClient
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', currentSession.user.id)
    .select()
    .single();

  avatarButton.disabled = false;
  changeButton.disabled = false;
  if (profileError) {
    showProfileMessage(`A foto foi enviada, mas não foi possível guardar o perfil: ${profileError.message}`, true);
    return;
  }

  currentProfile = data;
  updateProfileAvatar(avatarUrl);
  updateAuthInterface(currentSession);
  showProfileMessage('Foto de perfil atualizada com sucesso.');
}

function setProfileForm(profile) {
  const metadataName = currentSession?.user?.user_metadata?.full_name || currentSession?.user?.user_metadata?.name || '';
  document.getElementById('profile-full-name').value = profile?.full_name || metadataName;
  document.getElementById('profile-role-select').value = profile?.role || '';
  const professionalTitleSelect = document.getElementById('profile-professional-title');
  const existingTitle = profile?.professional_title || '';
  if (existingTitle && !Array.from(professionalTitleSelect.options).some(option => option.value === existingTitle)) {
    const legacyOption = new Option(`${existingTitle} (atual)`, existingTitle);
    professionalTitleSelect.insertBefore(legacyOption, professionalTitleSelect.options[1]);
  }
  professionalTitleSelect.value = existingTitle;
  document.getElementById('profile-bio').value = profile?.bio || '';
  document.getElementById('profile-location').value = profile?.location || '';
  document.getElementById('profile-phone').value = profile?.phone || '';
  document.getElementById('profile-website-url').value = profile?.website_url || '';
  document.getElementById('profile-linkedin-url').value = profile?.linkedin_url || '';
  document.getElementById('profile-experience').value = profile?.experience || '';
  document.getElementById('profile-education').value = profile?.education || '';
  document.getElementById('profile-availability').value = profile?.availability || '';
  document.getElementById('profile-hourly-rate').value = profile?.hourly_rate ?? '';
  profileFormSkills = Array.isArray(profile?.skills) ? [...profile.skills] : [];
  renderProfileSkills(profileFormSkills);
}

const PROFILE_TITLE_SKILLS = {
  'Desenvolvedor Web': ['Desenvolvimento Web', 'HTML/CSS', 'JavaScript', 'React', 'Next.js', 'Node.js', 'TypeScript', 'APIs', 'SQL', 'WordPress'],
  'Desenvolvedor Front-end': ['HTML/CSS', 'JavaScript', 'React', 'Next.js', 'TypeScript', 'UI/UX Design'],
  'Desenvolvedor Back-end': ['Node.js', 'Python', 'PHP', 'Java', 'APIs', 'SQL', 'Banco de Dados'],
  'Desenvolvedor Full Stack': ['Desenvolvimento Full Stack', 'JavaScript', 'React', 'Node.js', 'SQL', 'APIs', 'Next.js'],
  'Desenvolvedor Mobile': ['Desenvolvimento Mobile', 'Flutter', 'React Native', 'Android', 'iOS', 'Java', 'Kotlin'],
  'Designer Gráfico': ['Design Gráfico', 'Canva', 'Photoshop', 'Illustrator', 'Figma', 'Branding'],
  'UI/UX Designer': ['UI/UX Design', 'Figma', 'Web Design', 'Prototipagem', 'Design de Interfaces', 'Pesquisa de Usuário'],
  'Web Designer': ['Web Design', 'HTML/CSS', 'UI/UX Design', 'WordPress', 'Figma', 'Canva'],
  'Editor de Vídeo': ['Edição de Vídeo', 'CapCut', 'Premiere Pro', 'After Effects', 'Motion Design'],
  'Criador de Conteúdo': ['Criação de Conteúdo', 'Redes Sociais', 'TikTok', 'YouTube', 'Storytelling', 'Edição de Vídeo'],
  'Social Media Manager': ['Social Media', 'Redes Sociais', 'Marketing Digital', 'Criação de Conteúdo', 'Copywriting', 'SEO'],
  'Especialista em Marketing Digital': ['Marketing Digital', 'SEO', 'Google Ads', 'Facebook Ads', 'Redes Sociais', 'Copywriting'],
  'Especialista em SEO': ['SEO', 'Marketing de Conteúdo', 'Google Analytics', 'Pesquisa de Palavras-chave', 'Copywriting'],
  Copywriter: ['Copywriting', 'Redação', 'Marketing de Conteúdo', 'Storytelling', 'Email Marketing'],
  Tradutor: ['Tradução', 'Português', 'Inglês', 'Francês', 'Espanhol', 'Interpretação'],
  'Assistente Virtual': ['Assistência Virtual', 'Assistência Administrativa', 'Atendimento ao Cliente', 'Digitação', 'Organização de Documentos', 'Entrada de Dados'],
  'Assistente Administrativo': ['Assistência Administrativa', 'Administração', 'Digitação', 'Excel', 'Organização de Documentos', 'Atendimento ao Cliente'],
  'Atendente ao Cliente': ['Atendimento ao Cliente', 'Comunicação', 'Vendas', 'Negociação', 'Assistência Virtual'],
  Recepcionista: ['Recepção', 'Atendimento ao Cliente', 'Comunicação', 'Administração', 'Organização de Documentos'],
  Vendedor: ['Vendas', 'Atendimento ao Cliente', 'Negociação', 'Marketing Digital', 'Comunicação'],
  'Consultor de Negócios': ['Consultoria', 'Gestão de Negócios', 'Estratégia', 'Vendas', 'Negociação'],
  'Gestor de Projetos': ['Gestão de Projetos', 'Gestão de Negócios', 'Liderança', 'Organização', 'Comunicação'],
  Contabilista: ['Contabilidade', 'Finanças', 'Excel', 'Administração', 'Gestão de Negócios'],
  'Técnico de Informática': ['Suporte Técnico', 'Redes de Computadores', 'Hardware', 'Software', 'Cibersegurança'],
  'Analista de Dados': ['Análise de Dados', 'SQL', 'Excel', 'Python', 'Banco de Dados'],
  'Profissional de Recursos Humanos': ['Recursos Humanos', 'Recrutamento', 'Gestão de Pessoas', 'Administração', 'Comunicação'],
  Recrutador: ['Recrutamento', 'Recursos Humanos', 'Entrevistas', 'Comunicação', 'Gestão de Pessoas'],
  Professor: ['Ensino', 'Tutoria', 'Formação Profissional', 'Matemática', 'Língua Portuguesa', 'Língua Inglesa'],
  Tutor: ['Ensino', 'Tutoria', 'Formação Profissional', 'Matemática', 'Língua Portuguesa', 'Língua Inglesa']
};

const PROFILE_SKILL_CATEGORIES = {
  'Tecnologia': ['Desenvolvimento Web', 'Desenvolvimento Front-end', 'Desenvolvimento Back-end', 'Desenvolvimento Full Stack', 'Desenvolvimento Mobile', 'JavaScript', 'TypeScript', 'React', 'Next.js', 'Node.js', 'Python', 'PHP', 'Java', 'C#', 'SQL', 'Banco de Dados', 'APIs', 'WordPress', 'Suporte Técnico', 'Redes de Computadores', 'Cibersegurança'],
  'Design': ['Design Gráfico', 'UI/UX Design', 'Web Design', 'Canva', 'Photoshop', 'Illustrator', 'Figma', 'Edição de Vídeo', 'Animação', 'Fotografia'],
  'Marketing': ['Marketing Digital', 'Marketing de Conteúdo', 'Redes Sociais', 'Social Media', 'SEO', 'Google Ads', 'Facebook Ads', 'Copywriting', 'Email Marketing', 'Branding'],
  'Negócios': ['Vendas', 'Atendimento ao Cliente', 'Negociação', 'Gestão de Projetos', 'Gestão de Negócios', 'Consultoria', 'Empreendedorismo', 'Recursos Humanos', 'Recrutamento', 'Administração'],
  'Serviços': ['Assistência Virtual', 'Assistência Administrativa', 'Recepção', 'Digitação', 'Pesquisa Online', 'Entrada de Dados', 'Transcrição', 'Organização de Documentos'],
  'Idiomas': ['Português', 'Inglês', 'Francês', 'Espanhol', 'Tradução', 'Interpretação'],
  'Educação': ['Ensino', 'Tutoria', 'Formação Profissional', 'Matemática', 'Ciências', 'Língua Portuguesa', 'Língua Inglesa'],
  'Criatividade e Conteúdo': ['Criação de Conteúdo', 'Redação', 'Blog', 'Roteiros', 'YouTube', 'TikTok', 'Podcast', 'Storytelling']
};

function allProfileSkills() {
  const title = document.getElementById('profile-professional-title')?.value || '';
  const relevant = PROFILE_TITLE_SKILLS[title] || [];
  const general = Object.entries(PROFILE_SKILL_CATEGORIES).flatMap(([category, skills]) => skills.map(skill => ({ category, skill })));
  const ordered = [...relevant.map(skill => ({ category: 'Sugestões para o seu título', skill })), ...general];
  const seen = new Set();
  return ordered.filter(item => {
    const key = item.skill.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderProfileSkills(skills) {
  const container = document.getElementById('profile-skills-editor');
  const empty = document.getElementById('profile-skills-empty');
  container.innerHTML = skills.map((skill, index) => `<span class="skill-chip">${escapeHtml(skill)}<button type="button" aria-label="Remover ${escapeHtml(skill)}" onclick="removeProfileSkill(${index})">×</button></span>`).join('');
  empty.hidden = skills.length > 0;
  renderSkillOptions();
}

function renderSkillOptions(query = '') {
  const container = document.getElementById('profile-skill-options');
  if (!container) return;
  const normalizedQuery = query.trim().toLowerCase();
  const selected = new Set(profileFormSkills.map(skill => skill.toLowerCase()));
  const matches = allProfileSkills().filter(({ skill }) => !normalizedQuery || skill.toLowerCase().includes(normalizedQuery));
  const categories = [...new Set(matches.map(item => item.category))];
  const groups = categories.map(category => {
    const options = matches.filter(item => item.category === category);
    if (!options.length) return '';
    return `<div class="skill-category"><h5>${category}</h5>${options.map(({ skill }) => `<button type="button" class="skill-option ${selected.has(skill.toLowerCase()) ? 'selected' : ''}" onclick="toggleProfileSkill('${skill.replace(/'/g, "\\'")}')"><span>${escapeHtml(skill)}</span><span aria-hidden="true">${selected.has(skill.toLowerCase()) ? '✓' : '+'}</span></button>`).join('')}</div>`;
  }).join('');
  container.innerHTML = groups || '<p class="form-hint">Nenhuma competência encontrada.</p>';
}

function filterSkillOptions() {
  renderSkillOptions(document.getElementById('profile-skill-search').value);
}

function updateSkillsSelectorUI() {
  const picker = document.getElementById('profile-skills-picker');
  if (!picker) return;
  picker.hidden = !skillsSelectorOpen;
  picker.setAttribute('aria-hidden', String(!skillsSelectorOpen));
  picker.style.display = skillsSelectorOpen ? 'grid' : 'none';
}

function closeSkillsSelector() {
  skillsSelectorOpen = false;
  updateSkillsSelectorUI();
}

function toggleSkillsPicker(force) {
  skillsSelectorOpen = typeof force === 'boolean' ? force : !skillsSelectorOpen;
  updateSkillsSelectorUI();
  if (!skillsSelectorOpen) return;
  document.getElementById('profile-skill-search').value = '';
  renderSkillOptions();
  document.getElementById('profile-skill-search').focus();
}

function toggleProfileSkill(skill) {
  const index = profileFormSkills.findIndex(item => item.toLowerCase() === skill.toLowerCase());
  if (index >= 0) {
    profileFormSkills.splice(index, 1);
  } else if (profileFormSkills.length >= 5) {
    showProfileMessage('Limite de 5 competências atingido.', true);
    return;
  } else {
    profileFormSkills.push(skill);
  }
  renderProfileSkills(profileFormSkills);
  const query = document.getElementById('profile-skill-search')?.value || '';
  renderSkillOptions(query);
}

function addProfileSkill(event) {
  event.preventDefault();
  const input = document.getElementById('profile-skill-input');
  const skill = input.value.trim();
  if (!skill) return;
  const skills = [...profileFormSkills];
  const existing = skills.map(item => item.toLowerCase());
  if (!existing.includes(skill.toLowerCase())) skills.push(skill);
  profileFormSkills = skills;
  renderProfileSkills(profileFormSkills);
  input.value = '';
}

function removeProfileSkill(index) {
  profileFormSkills.splice(index, 1);
  renderProfileSkills(profileFormSkills);
}

function showProfileMessage(message, isError = false) {
  const element = document.getElementById('profile-message');
  element.innerText = message;
  element.className = isError ? 'profile-message error' : 'profile-message';
}

async function loadProfile(session) {
  if (!session?.user) return;

  const { data, error } = await supabaseClient
    .from('profiles')
    .select('id, full_name, avatar_url, role, bio, location, skills, experience, education, website_url, linkedin_url, phone, availability, hourly_rate, professional_title, created_at, updated_at')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) {
    currentProfile = null;
    showProfileMessage('Não foi possível carregar o perfil. Confirme se a tabela profiles foi criada no Supabase.', true);
  } else {
    currentProfile = data;
    setProfileForm(data);
  }
  updateAuthInterface(session);
}

async function toggleProfileEditor() {
  const form = document.getElementById('profile-form');
  const editing = form.hidden;
  if (!editing) {
    form.hidden = true;
    setProfileForm(currentProfile);
    showProfileMessage('');
    return;
  }

  form.hidden = false;
  showProfileMessage('Carregando perfil...');
  await loadProfile(currentSession);
  setProfileForm(currentProfile);
  showProfileMessage('');
}

function closeProfileEditor() {
  const form = document.getElementById('profile-form');
  form.hidden = true;
  closeSkillsSelector();
}

function cancelProfileEdit() {
  closeProfileEditor();
  setProfileForm(currentProfile);
  showProfileMessage('');
}

async function saveProfile(event) {
  event.preventDefault();
  if (!currentSession?.user) return;

  const fullName = document.getElementById('profile-full-name').value.trim();
  const role = document.getElementById('profile-role-select').value;
  const hourlyRateValue = document.getElementById('profile-hourly-rate').value.trim();
  const allowedRoles = ['freelancer', 'job_seeker', 'remote_worker', 'creator', 'business'];
  if (!fullName || !allowedRoles.includes(role)) {
    showProfileMessage('Informe o nome completo e o tipo de utilizador.', true);
    return;
  }
  if (hourlyRateValue && (!Number.isFinite(Number(hourlyRateValue)) || Number(hourlyRateValue) < 0)) {
    showProfileMessage('Informe um valor por hora válido e não negativo.', true);
    return;
  }

  const saveButton = document.getElementById('profile-save-button');
  saveButton.disabled = true;
  showProfileMessage('Salvando perfil...');
  const payload = {
    id: currentSession.user.id,
    full_name: fullName,
    role,
    professional_title: document.getElementById('profile-professional-title').value.trim() || null,
    bio: document.getElementById('profile-bio').value.trim() || null,
    location: document.getElementById('profile-location').value.trim() || null,
    phone: document.getElementById('profile-phone').value.trim() || null,
    website_url: document.getElementById('profile-website-url').value.trim() || null,
    linkedin_url: document.getElementById('profile-linkedin-url').value.trim() || null,
    experience: document.getElementById('profile-experience').value.trim() || null,
    education: document.getElementById('profile-education').value.trim() || null,
    availability: document.getElementById('profile-availability').value.trim() || null,
    hourly_rate: hourlyRateValue ? Number(hourlyRateValue) : null,
    skills: profileFormSkills
  };

  const { data, error } = await supabaseClient
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select('id, full_name, avatar_url, role, bio, location, skills, experience, education, website_url, linkedin_url, phone, availability, hourly_rate, professional_title, created_at, updated_at')
    .single();

  saveButton.disabled = false;
  if (error) {
    showProfileMessage(error.message, true);
    return;
  }

  currentProfile = data;
  updateAuthInterface(currentSession);
  closeProfileEditor();
  showProfileMessage('Perfil atualizado com sucesso.');
}

async function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    showAuthMessage('Preencha o e-mail e a senha para entrar.', true);
    return;
  }

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) showAuthMessage(error.message, true);
}

async function loginWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });

  if (error) showAuthMessage(error.message, true);
}

async function register() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    showAuthMessage('Preencha o e-mail e a senha para se cadastrar.', true);
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) {
    showAuthMessage(error.message, true);
  } else if (!data.session) {
    showAuthMessage('Cadastro realizado. Confirme seu e-mail para ativar a conta.');
  }
}

async function logout() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) showAuthMessage(error.message, true);
}

async function initializeAuth() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    showAuthMessage(error.message, true);
    updateAuthInterface(null);
    return;
  }

  updateAuthInterface(data.session);
  await loadProfile(data.session);
  await checkAdminAccess();
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    updateAuthInterface(session);
    if (session) {
      loadProfile(session).then(checkAdminAccess);
    }
  });
}

// ============================================================================
// DEPOIMENTOS E FEEDBACK DOS UTILIZADORES (Home Page)
// ============================================================================
const DEFAULT_TESTIMONIALS = [
  {
    id: 'testim-1',
    author: 'Mateus Manuel',
    title: 'Desenvolvedor Full Stack & Freelancer',
    category: 'freelancer',
    rating: 5,
    quote: 'Encontrei projetos incríveis através das ofertas do QUINZOWORK. O fluxo de candidatura, comunicação com contratantes e a segurança dos dados são impecáveis.',
    date: '14 de Setembro, 2026',
    avatarInitials: 'MM',
    avatarGradient: 'linear-gradient(135deg, #00f2fe, #4facfe)',
    badgeText: 'Freelancer'
  },
  {
    id: 'testim-2',
    author: 'Teresa Vandúnem',
    title: 'Diretora de Recursos Humanos na InovAngola',
    category: 'company',
    rating: 5,
    quote: 'Recrutamos três especialistas seniores em tempo recorde usando o painel do QUINZOWORK. A curadoria de perfis verificados e a agilidade da plataforma superaram as nossas metas.',
    date: '08 de Setembro, 2026',
    avatarInitials: 'TV',
    avatarGradient: 'linear-gradient(135deg, #a855f7, #6366f1)',
    badgeText: 'Empresa'
  },
  {
    id: 'testim-3',
    author: 'Adilson Santos',
    title: 'Especialista em UI/UX & Design Digital',
    category: 'freelancer',
    rating: 5,
    quote: 'A visibilidade que o meu perfil público ganhou aqui acelerou muito as solicitações de projetos. É a melhor plataforma moderna para profissionais e criadores digitais.',
    date: '02 de Setembro, 2026',
    avatarInitials: 'AS',
    avatarGradient: 'linear-gradient(135deg, #f59e0b, #ef4444)',
    badgeText: 'Freelancer'
  },
  {
    id: 'testim-4',
    author: 'Carla Fernandes',
    title: 'Fundadora da ModaZuri & Cliente da Loja',
    category: 'client',
    rating: 5,
    quote: 'Adquiri o pacote de desenvolvimento web e suporte contínuo na Loja. A equipa entregou a solução antes do prazo com segurança e qualidade extrema!',
    date: '28 de Agosto, 2026',
    avatarInitials: 'CF',
    avatarGradient: 'linear-gradient(135deg, #10b981, #06b6d4)',
    badgeText: 'Cliente Loja'
  },
  {
    id: 'testim-5',
    author: 'Eng. Domingos Kiala',
    title: 'CTO na Nexus Soluções Tecnológicas',
    category: 'company',
    rating: 5,
    quote: 'A facilidade de publicação e gestão de ofertas de trabalho remotas nos permitiu escalar a nossa equipa técnica sem burocracia desnecessária.',
    date: '19 de Agosto, 2026',
    avatarInitials: 'DK',
    avatarGradient: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
    badgeText: 'Empresa'
  }
];

let testimonialsList = [];
let testimonialsCurrentIndex = 0;
let testimonialsViewMode = 'carousel';
let testimonialsCategoryFilter = 'all';
let testimonialsAutoplayTimer = null;
let testimonialTouchStartX = 0;
let testimonialTouchEndX = 0;

function loadStoredTestimonials() {
  try {
    const raw = localStorage.getItem('quinzowork_testimonials');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Erro ao carregar depoimentos salvos:', e);
  }
  return [...DEFAULT_TESTIMONIALS];
}

function saveTestimonialsToStorage() {
  try {
    localStorage.setItem('quinzowork_testimonials', JSON.stringify(testimonialsList));
  } catch (e) {
    console.warn('Erro ao guardar depoimentos:', e);
  }
}

function getFilteredTestimonials() {
  if (testimonialsCategoryFilter === 'all') {
    return testimonialsList;
  }
  return testimonialsList.filter(item => item.category === testimonialsCategoryFilter);
}

function renderStars(rating) {
  const num = Math.max(1, Math.min(5, Number(rating) || 5));
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    stars += i <= num ? '★' : '☆';
  }
  return stars;
}

function renderTestimonials() {
  const track = document.getElementById('testimonials-track');
  const pagination = document.getElementById('testimonials-pagination');
  const prevBtn = document.getElementById('testimonials-prev-btn');
  const nextBtn = document.getElementById('testimonials-next-btn');
  const stage = document.getElementById('testimonials-stage');
  if (!track || !stage) return;

  const filtered = getFilteredTestimonials();

  if (filtered.length === 0) {
    track.innerHTML = `
      <div class="testimonial-card-wrapper" style="width: 100%; text-align: center; padding: 40px 20px;">
        <div class="testimonial-card" style="text-align: center;">
          <p style="color: #94a3b8; margin-bottom: 12px;">Ainda não há depoimentos nesta categoria.</p>
          <button type="button" class="btn-primary" style="width: auto; margin: 0 auto; display: inline-block;" onclick="openFeedbackModal()">Seja o primeiro a avaliar!</button>
        </div>
      </div>
    `;
    if (pagination) pagination.innerHTML = '';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  let itemsVisible = 1;
  if (window.innerWidth >= 1100) itemsVisible = 3;
  else if (window.innerWidth >= 768) itemsVisible = 2;

  const maxIndex = Math.max(0, filtered.length - itemsVisible);
  if (testimonialsCurrentIndex > maxIndex) {
    testimonialsCurrentIndex = maxIndex;
  }

  track.innerHTML = filtered.map((item, idx) => {
    const categoryClass = item.category === 'company' ? 'company' : (item.category === 'client' ? 'client' : '');
    const gradient = item.avatarGradient || 'linear-gradient(135deg, #00f2fe, #4facfe)';
    const initials = item.avatarInitials || (item.author ? item.author.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() : 'U');

    return `
      <div class="testimonial-card-wrapper" id="testimonial-item-${item.id || idx}">
        <article class="testimonial-card" id="card-${item.id || idx}">
          <div class="testimonial-card-top">
            <div class="testimonial-rating" aria-label="${item.rating} de 5 estrelas">
              ${renderStars(item.rating)}
            </div>
            <span class="testimonial-badge ${categoryClass}">${escapeHtml(item.badgeText || (item.category === 'company' ? 'Empresa' : (item.category === 'client' ? 'Cliente' : 'Freelancer')))}</span>
          </div>

          <p class="testimonial-quote">${escapeHtml(item.quote)}</p>

          <div class="testimonial-author-block">
            <div class="testimonial-avatar" style="background: ${gradient};" aria-hidden="true">
              ${escapeHtml(initials)}
            </div>
            <div class="testimonial-author-info">
              <span class="testimonial-author-name">
                ${escapeHtml(item.author)}
                <span class="verified-icon" title="Utilizador Verificado" aria-label="Verificado">✓</span>
              </span>
              <span class="testimonial-author-title">${escapeHtml(item.title)}</span>
              <span class="testimonial-date">${escapeHtml(item.date)}</span>
            </div>
          </div>
        </article>
      </div>
    `;
  }).join('');

  if (testimonialsViewMode === 'carousel') {
    const itemWidthPercent = 100 / itemsVisible;
    const offset = testimonialsCurrentIndex * itemWidthPercent;
    track.style.transform = `translateX(-${offset}%)`;

    if (prevBtn) prevBtn.disabled = testimonialsCurrentIndex === 0;
    if (nextBtn) nextBtn.disabled = testimonialsCurrentIndex >= maxIndex;

    if (pagination) {
      const totalPages = maxIndex + 1;
      if (totalPages > 1) {
        pagination.innerHTML = Array.from({ length: totalPages }, (_, i) => `
          <button type="button" 
                  class="pagination-dot ${i === testimonialsCurrentIndex ? 'active' : ''}" 
                  id="testimonial-dot-${i}"
                  onclick="goToTestimonial(${i})" 
                  aria-label="Ir para depoimento ${i + 1}"
                  aria-current="${i === testimonialsCurrentIndex ? 'true' : 'false'}"></button>
        `).join('');
      } else {
        pagination.innerHTML = '';
      }
    }
  } else {
    track.style.transform = 'none';
    if (pagination) pagination.innerHTML = '';
  }
}

function setTestimonialsView(mode) {
  testimonialsViewMode = mode;
  const stage = document.getElementById('testimonials-stage');
  const btnCarousel = document.getElementById('btn-testimonials-carousel');
  const btnGrid = document.getElementById('btn-testimonials-grid');

  if (mode === 'grid') {
    stage?.classList.remove('carousel-mode');
    stage?.classList.add('grid-mode');
    btnCarousel?.classList.remove('active');
    btnCarousel?.setAttribute('aria-pressed', 'false');
    btnGrid?.classList.add('active');
    btnGrid?.setAttribute('aria-pressed', 'true');
    stopTestimonialsAutoplay();
  } else {
    stage?.classList.remove('grid-mode');
    stage?.classList.add('carousel-mode');
    btnGrid?.classList.remove('active');
    btnGrid?.setAttribute('aria-pressed', 'false');
    btnCarousel?.classList.add('active');
    btnCarousel?.setAttribute('aria-pressed', 'true');
    startTestimonialsAutoplay();
  }

  renderTestimonials();
}

function filterTestimonials(category) {
  testimonialsCategoryFilter = category;
  testimonialsCurrentIndex = 0;

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.classList.remove('active');
    chip.setAttribute('aria-selected', 'false');
  });

  const activeChipId = category === 'all' 
    ? 'filter-chip-all' 
    : (category === 'freelancer' ? 'filter-chip-freelancers' : (category === 'company' ? 'filter-chip-companies' : 'filter-chip-clients'));
  const activeChip = document.getElementById(activeChipId);
  if (activeChip) {
    activeChip.classList.add('active');
    activeChip.setAttribute('aria-selected', 'true');
  }

  renderTestimonials();
}

function prevTestimonial() {
  if (testimonialsCurrentIndex > 0) {
    testimonialsCurrentIndex--;
    renderTestimonials();
  } else {
    const filtered = getFilteredTestimonials();
    let itemsVisible = 1;
    if (window.innerWidth >= 1100) itemsVisible = 3;
    else if (window.innerWidth >= 768) itemsVisible = 2;
    const maxIndex = Math.max(0, filtered.length - itemsVisible);
    testimonialsCurrentIndex = maxIndex;
    renderTestimonials();
  }
}

function nextTestimonial() {
  const filtered = getFilteredTestimonials();
  let itemsVisible = 1;
  if (window.innerWidth >= 1100) itemsVisible = 3;
  else if (window.innerWidth >= 768) itemsVisible = 2;
  const maxIndex = Math.max(0, filtered.length - itemsVisible);

  if (testimonialsCurrentIndex < maxIndex) {
    testimonialsCurrentIndex++;
    renderTestimonials();
  } else {
    testimonialsCurrentIndex = 0;
    renderTestimonials();
  }
}

function goToTestimonial(index) {
  testimonialsCurrentIndex = index;
  renderTestimonials();
}

function startTestimonialsAutoplay() {
  stopTestimonialsAutoplay();
  if (testimonialsViewMode !== 'carousel') return;
  testimonialsAutoplayTimer = setInterval(() => {
    const homePage = document.getElementById('home');
    if (homePage && homePage.classList.contains('active')) {
      nextTestimonial();
    }
  }, 5000);
}

function stopTestimonialsAutoplay() {
  if (testimonialsAutoplayTimer) {
    clearInterval(testimonialsAutoplayTimer);
    testimonialsAutoplayTimer = null;
  }
}

function openFeedbackModal() {
  stopTestimonialsAutoplay();
  const overlay = document.getElementById('feedback-modal-overlay');
  if (overlay) {
    overlay.hidden = false;
    document.getElementById('feedback-input-author')?.focus();
  }
}

function closeFeedbackModal() {
  const overlay = document.getElementById('feedback-modal-overlay');
  if (overlay) {
    overlay.hidden = true;
  }
  if (testimonialsViewMode === 'carousel') {
    startTestimonialsAutoplay();
  }
}

function handleFeedbackOverlayClick(event) {
  if (event.target && event.target.id === 'feedback-modal-overlay') {
    closeFeedbackModal();
  }
}

function handleFeedbackSubmit(event) {
  event.preventDefault();
  const author = document.getElementById('feedback-input-author')?.value.trim();
  const title = document.getElementById('feedback-input-title')?.value.trim();
  const category = document.getElementById('feedback-select-category')?.value;
  const rating = Number(document.getElementById('feedback-select-rating')?.value) || 5;
  const quote = document.getElementById('feedback-textarea-quote')?.value.trim();

  if (!author || !title || !quote) {
    alert('Por favor, preencha todos os campos obrigatórios.');
    return;
  }

  const gradients = [
    'linear-gradient(135deg, #00f2fe, #4facfe)',
    'linear-gradient(135deg, #a855f7, #6366f1)',
    'linear-gradient(135deg, #10b981, #06b6d4)',
    'linear-gradient(135deg, #f59e0b, #ef4444)',
    'linear-gradient(135deg, #ec4899, #8b5cf6)'
  ];
  const chosenGradient = gradients[Math.floor(Math.random() * gradients.length)];
  const initials = author.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'U';

  const categoryLabels = {
    freelancer: 'Freelancer',
    company: 'Empresa',
    client: 'Cliente Loja'
  };

  const today = new Date();
  const dateFormatted = today.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });

  const newTestimonial = {
    id: 'custom-' + Date.now(),
    author,
    title,
    category,
    rating,
    quote,
    date: dateFormatted,
    avatarInitials: initials,
    avatarGradient: chosenGradient,
    badgeText: categoryLabels[category] || 'Utilizador'
  };

  testimonialsList.unshift(newTestimonial);
  saveTestimonialsToStorage();

  testimonialsCategoryFilter = 'all';
  testimonialsCurrentIndex = 0;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  document.getElementById('filter-chip-all')?.classList.add('active');

  closeFeedbackModal();
  document.getElementById('feedback-submission-form')?.reset();
  renderTestimonials();

  const firstCard = document.querySelector('.testimonial-card');
  if (firstCard) {
    firstCard.style.boxShadow = '0 0 25px rgba(0, 242, 254, 0.8)';
    setTimeout(() => {
      firstCard.style.boxShadow = '';
    }, 2500);
  }
}

function initTestimonials() {
  testimonialsList = loadStoredTestimonials();
  renderTestimonials();
  startTestimonialsAutoplay();

  const stage = document.getElementById('testimonials-stage');
  if (stage) {
    stage.addEventListener('mouseenter', stopTestimonialsAutoplay);
    stage.addEventListener('mouseleave', () => {
      if (testimonialsViewMode === 'carousel') startTestimonialsAutoplay();
    });

    stage.addEventListener('touchstart', (e) => {
      testimonialTouchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    stage.addEventListener('touchend', (e) => {
      testimonialTouchEndX = e.changedTouches[0].screenX;
      if (testimonialsViewMode !== 'carousel') return;
      const diff = testimonialTouchStartX - testimonialTouchEndX;
      if (Math.abs(diff) > 40) {
        if (diff > 0) nextTestimonial();
        else prevTestimonial();
      }
    }, { passive: true });
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderTestimonials();
    }, 150);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('skills-done-button')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeSkillsSelector();
  });
  loadProducts();
  initializeAuth();
  openProfileFromUrl();
  initTestimonials();
});
