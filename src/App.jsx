import React, { useState, useEffect } from 'react';
import { supabase, ADMIN_PASSWORD, DEFAULT_MEMBER_PASSWORD } from './lib/supabase';

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [role, setRole] = useState('admin');
  const [tasks, setTasks] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [newLog, setNewLog] = useState({ summary: '', percent: 0, file: null });
  const [newMsg, setNewMsg] = useState('');
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [alertBanner, setAlertBanner] = useState(null); // { type: 'success'|'error'|'warning'|'info', message: '' }

  // Login form state
  const [loginTab, setLoginTab] = useState('member'); // 'member' | 'admin'
  const [loginIts, setLoginIts] = useState('');
  const [loginPassword, setLoginPassword] = useState(DEFAULT_MEMBER_PASSWORD);
  const [showMemberPassword, setShowMemberPassword] = useState(false);

  const [adminEmail, setAdminEmail] = useState('admin@siddhpur.com');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  // New task form state
  const [taskForm, setTaskForm] = useState({ title: '', description: '', assigned_to: '', due_date: '' });
  // New member form state
  const [memberForm, setMemberForm] = useState({ full_name: '', its_number: '', phone: '', role: 'member' });
  const [showAddMember, setShowAddMember] = useState(false);

  // Event dates
  const eventStart = new Date('2026-10-01');
  const eventEnd = new Date('2026-11-15');
  const today = new Date();
  const totalDays = Math.max(1, Math.round((eventEnd - eventStart) / (1000 * 60 * 60 * 24)));
  const daysElapsed = Math.max(0, Math.round((today - eventStart) / (1000 * 60 * 60 * 24)));
  const daysLeft = Math.max(0, Math.round((eventEnd - today) / (1000 * 60 * 60 * 24)));

  useEffect(() => {
    // 1. Restore local session if active
    const savedSession = localStorage.getItem('siddhpur_portal_session');
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        if (parsed?.id) {
          setCurrentUser(parsed);
          setRole(parsed.role || 'member');
        }
      } catch (e) {
        console.warn('Session parse error:', e);
      }
    }

    // 2. Initial fetch
    fetchData();

    // 3. Set up Realtime listener for live synchronization across users
    const channel = supabase
      .channel('portal-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        fetchData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function showAlert(message, type = 'info', timeout = 6000) {
    setAlertBanner({ message, type });
    if (timeout) {
      setTimeout(() => setAlertBanner(null), timeout);
    }
  }

  async function fetchData() {
    try {
      const { data: tData, error: tErr } = await supabase
        .from('tasks')
        .select('*, profiles(full_name, its_number)')
        .order('created_at', { ascending: false });

      if (tErr) {
        console.error('Error fetching tasks:', tErr);
      } else if (tData) {
        setTasks(tData);
      }

      const { data: pData, error: pErr } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name', { ascending: true });

      if (pErr) {
        console.error('Error fetching profiles:', pErr);
      } else if (pData) {
        setProfiles(pData);
      }
    } catch (err) {
      console.error('Unexpected error fetching data:', err);
    }
  }

  // --- MEMBER LOGIN (8-Digit ITS + default 786110) ---
  async function handleMemberLogin(e) {
    e.preventDefault();
    const cleanIts = loginIts.trim();

    if (!cleanIts) {
      showAlert('Please enter your 8-digit ITS number.', 'error');
      return;
    }

    if (!/^\d{8}$/.test(cleanIts)) {
      showAlert('ITS number must be exactly 8 digits.', 'error');
      return;
    }

    if (!loginPassword) {
      showAlert('Please enter your password (default: 786110).', 'error');
      return;
    }

    setLoading(true);
    const authEmail = `${cleanIts}@siddhpur.com`;

    try {
      // 1. Check if ITS exists in registered profiles
      const { data: matchedProfile, error: pErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('its_number', cleanIts)
        .maybeSingle();

      if (pErr) {
        console.error('Profile lookup error:', pErr);
      }

      if (!matchedProfile) {
        showAlert(
          `ITS ${cleanIts} is not registered in the Tayyari Portal. Please contact Markaz Admin to register your ITS.`,
          'error'
        );
        setLoading(false);
        return;
      }

      // 2. Attempt Supabase Auth login
      let authSuccessful = false;
      try {
        const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: loginPassword
        });

        if (!authErr && authData?.session) {
          authSuccessful = true;
        } else if (authErr && authErr.message.includes('Invalid login credentials')) {
          // Attempt automatic signup in Supabase Auth if not yet created
          await supabase.auth.signUp({
            email: authEmail,
            password: loginPassword,
            options: { data: { full_name: matchedProfile.full_name, its_number: cleanIts } }
          }).catch(() => {});
        }
      } catch (authErr) {
        console.warn('Supabase Auth error (falling back to verified profile credentials):', authErr);
      }

      // 3. Verify password (matches default 786110 or passed Supabase auth)
      if (loginPassword === DEFAULT_MEMBER_PASSWORD || authSuccessful) {
        const sessionObj = {
          id: matchedProfile.id,
          full_name: matchedProfile.full_name,
          its_number: matchedProfile.its_number,
          phone: matchedProfile.phone,
          role: matchedProfile.role || 'member'
        };

        localStorage.setItem('siddhpur_portal_session', JSON.stringify(sessionObj));
        setCurrentUser(sessionObj);
        setRole(matchedProfile.role || 'member');
        showAlert(`أهلاً وسهلاً! Welcome, ${matchedProfile.full_name}.`, 'success');
      } else {
        showAlert('Incorrect password. Default password for all members is 786110.', 'error');
      }
    } catch (err) {
      console.error('Login error:', err);
      showAlert(`Login failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // --- ADMIN LOGIN (Unique Password) ---
  async function handleAdminLogin(e) {
    e.preventDefault();
    if (!adminPassword.trim()) {
      showAlert('Please enter the Central Admin password.', 'error');
      return;
    }

    setLoading(true);

    try {
      let isAuthorized = false;

      // 1. Verify against configured unique admin password
      if (adminPassword.trim() === ADMIN_PASSWORD.trim()) {
        isAuthorized = true;
      } else {
        // 2. Also test against Supabase Auth for admin user
        const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
          email: adminEmail.trim(),
          password: adminPassword.trim()
        });
        if (!authErr && authData?.session) {
          isAuthorized = true;
        }
      }

      if (isAuthorized) {
        const adminSession = {
          id: '00000000-0000-0000-0000-000000000000',
          full_name: 'Markaz Central Admin',
          role: 'admin',
          email: adminEmail.trim()
        };
        localStorage.setItem('siddhpur_portal_session', JSON.stringify(adminSession));
        setCurrentUser(adminSession);
        setRole('admin');
        showAlert('Welcome, Central Admin. Full management access granted.', 'success');
      } else {
        showAlert('Invalid Central Admin password. Please check your credentials.', 'error');
      }
    } catch (err) {
      console.error('Admin login error:', err);
      showAlert(`Admin login failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // --- LOGOUT ---
  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Sign out notice:', e);
    }
    localStorage.removeItem('siddhpur_portal_session');
    setCurrentUser(null);
    setRole('member');
    showAlert('You have safely exited the portal.', 'info');
  }

  // --- ADD MEMBER (Requires 8-Digit ITS) ---
  async function handleAddMember(e) {
    e.preventDefault();
    const cleanName = memberForm.full_name.trim();
    const cleanIts = memberForm.its_number.trim();

    if (!cleanName) {
      showAlert('Full name is required.', 'error');
      return;
    }

    if (!cleanIts || !/^\d{8}$/.test(cleanIts)) {
      showAlert('ITS number must be exactly 8 digits.', 'error');
      return;
    }

    // Check for duplicate ITS in current profiles list
    if (profiles.some(p => p.its_number === cleanIts)) {
      showAlert(`A member with ITS ${cleanIts} already exists.`, 'error');
      return;
    }

    setLoading(true);

    try {
      const { data: inserted, error: pErr } = await supabase.from('profiles').insert([{
        full_name: cleanName,
        its_number: cleanIts,
        phone: memberForm.phone.trim() || null,
        role: memberForm.role
      }]).select().single();

      if (pErr) {
        showAlert(`Failed to add member: ${pErr.message}`, 'error');
        setLoading(false);
        return;
      }

      // Provision user account in Supabase Auth in background (Email: <ITS>@siddhpur.com, PWD: 786110)
      supabase.auth.signUp({
        email: `${cleanIts}@siddhpur.com`,
        password: DEFAULT_MEMBER_PASSWORD,
        options: { data: { full_name: cleanName, its_number: cleanIts, role: memberForm.role } }
      }).catch(err => {
        console.warn('Auth background provisioning note:', err.message);
      });

      setMemberForm({ full_name: '', its_number: '', phone: '', role: 'member' });
      setShowAddMember(false);
      showAlert(`Member ${cleanName} added! Login ID: ${cleanIts} (Password: ${DEFAULT_MEMBER_PASSWORD})`, 'success', 8000);
      fetchData();
    } catch (err) {
      console.error('Error adding member:', err);
      showAlert(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // --- DELETE MEMBER ---
  async function handleDeleteMember(profileId, name) {
    if (!window.confirm(`Are you sure you want to remove ${name} from the portal?`)) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', profileId);
      if (error) {
        showAlert(`Failed to delete: ${error.message}`, 'error');
      } else {
        showAlert(`${name} removed.`, 'info');
        fetchData();
      }
    } catch (err) {
      showAlert(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // --- UPDATE MISSING ITS FOR LEGACY PROFILES ---
  async function handleAssignIts(profileId, name) {
    const newIts = window.prompt(`Enter 8-digit ITS number for ${name}:`);
    if (!newIts) return;
    const clean = newIts.trim();
    if (!/^\d{8}$/.test(clean)) {
      alert('ITS number must be exactly 8 digits.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from('profiles').update({ its_number: clean }).eq('id', profileId);
      if (error) {
        showAlert(`Failed to update ITS: ${error.message}`, 'error');
      } else {
        showAlert(`ITS ${clean} assigned to ${name}. They can now log in with password 786110.`, 'success');
        fetchData();
      }
    } catch (e) {
      showAlert(`Error: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // --- CREATE TASK ---
  async function handleCreateTask(e) {
    e.preventDefault();
    if (!taskForm.title.trim() || !taskForm.due_date) return;
    setLoading(true);

    try {
      const { error } = await supabase.from('tasks').insert([{
        title: taskForm.title.trim(),
        description: taskForm.description.trim() || null,
        assigned_to: taskForm.assigned_to || null,
        due_date: taskForm.due_date,
        progress_percent: 0,
        status: 'in_progress',
        start_date: new Date().toISOString().split('T')[0]
      }]);

      if (error) {
        showAlert(`Failed to create task: ${error.message}`, 'error');
      } else {
        setTaskForm({ title: '', description: '', assigned_to: '', due_date: '' });
        showAlert('Khidmat task deployed successfully!', 'success');
        fetchData();
      }
    } catch (err) {
      showAlert(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // --- TASK DETAILS MODAL & THREADS ---
  async function openTaskDetails(task) {
    setSelectedTask(task);
    setNewLog({ summary: '', percent: task.progress_percent || 0, file: null });
    try {
      const { data, error } = await supabase
        .from('task_threads')
        .select('*')
        .eq('task_id', task.id)
        .order('created_at', { ascending: true });

      if (!error) {
        setThreads(data || []);
      }
    } catch (err) {
      console.error('Thread fetch error:', err);
    }
  }

  // --- SUBMIT WORK LOG & PHOTO ---
  async function handleLogSubmit(e) {
    e.preventDefault();
    if (!selectedTask) return;
    setLoading(true);

    try {
      let photoUrl = null;
      if (newLog.file) {
        const fileExt = newLog.file.name.split('.').pop();
        const fileName = `${selectedTask.id}-${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('progress-photos')
          .upload(fileName, newLog.file);

        if (uploadError) {
          console.warn('Storage bucket note:', uploadError.message);
          showAlert(
            `Log saved. Note: Photo upload was skipped (${uploadError.message}). Ensure bucket 'progress-photos' is created in Supabase Storage.`,
            'warning',
            8000
          );
        } else {
          const { data: publicUrlData } = supabase.storage
            .from('progress-photos')
            .getPublicUrl(fileName);
          photoUrl = publicUrlData?.publicUrl || null;
        }
      }

      const { error: logErr } = await supabase.from('task_logs').insert([{
        task_id: selectedTask.id,
        user_id: currentUser?.id || null,
        summary: newLog.summary,
        percent_at_log: Number(newLog.percent),
        photo_url: photoUrl
      }]);

      if (logErr) {
        showAlert(`Failed to record log: ${logErr.message}`, 'error');
        setLoading(false);
        return;
      }

      const { error: taskUpdateErr } = await supabase
        .from('tasks')
        .update({ progress_percent: Number(newLog.percent) })
        .eq('id', selectedTask.id);

      if (taskUpdateErr) {
        showAlert(`Failed to update task percentage: ${taskUpdateErr.message}`, 'error');
      } else {
        showAlert('Progress log updated successfully.', 'success');
        setSelectedTask(prev => ({ ...prev, progress_percent: Number(newLog.percent) }));
        setNewLog({ summary: '', percent: Number(newLog.percent), file: null });
        fetchData();
      }
    } catch (err) {
      showAlert(`Error saving log: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  // --- SEND MESSAGE IN THREAD ---
  async function handleSendMessage(e) {
    e.preventDefault();
    if (!newMsg.trim() || !selectedTask) return;

    try {
      const messageContent = `${currentUser?.full_name || 'Member'}: ${newMsg.trim()}`;
      const { error } = await supabase.from('task_threads').insert([{
        task_id: selectedTask.id,
        sender_id: currentUser?.id || null,
        message: messageContent
      }]);

      if (error) {
        showAlert(`Could not send note: ${error.message}`, 'error');
      } else {
        setNewMsg('');
        const { data } = await supabase
          .from('task_threads')
          .select('*')
          .eq('task_id', selectedTask.id)
          .order('created_at', { ascending: true });
        setThreads(data || []);
      }
    } catch (err) {
      console.error('Send error:', err);
    }
  }

  // --- EXPORT CSV REPORT ---
  function exportReport() {
    let csv = "Task Name,Assigned To,ITS Number,Progress %,Due Date\n";
    tasks.forEach(t => {
      csv += `"${t.title.replace(/"/g, '""')}","${t.profiles?.full_name || 'Unassigned'}","${t.profiles?.its_number || 'N/A'}","${t.progress_percent || 0}%","${t.due_date || 'No Date'}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Siddhpur-Tayyari-Report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  const overallPercentage = tasks.length === 0
    ? 0
    : Math.round(tasks.reduce((acc, t) => acc + (Number(t.progress_percent) || 0), 0) / tasks.length);

  // =========================================================
  // VIEW: LOGIN SCREEN (MEMBER 8-DIGIT ITS / ADMIN UNIQUE PWD)
  // =========================================================
  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-900 p-4">
        <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border-t-8 border-emerald-700">
          {/* Header */}
          <div className="p-6 pb-4 text-center border-b border-stone-100">
            <h1 className="text-3xl font-bold font-fatimi text-emerald-900 mb-1">أهلاً وسهلاً</h1>
            <h2 className="text-base font-bold text-stone-800">Huzurala TUS Tashreef Aavri Siddhpur</h2>
            <p className="text-xs text-stone-500 mt-1">Al Jamea tus Saifiyah — Tayyari Portal</p>
          </div>

          {/* Alert Banner */}
          {alertBanner && (
            <div className={`mx-6 mt-4 p-3 rounded-xl text-xs font-semibold ${
              alertBanner.type === 'error' ? 'bg-rose-100 text-rose-800 border border-rose-200' :
              alertBanner.type === 'warning' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
              'bg-emerald-100 text-emerald-800 border border-emerald-200'
            }`}>
              {alertBanner.message}
            </div>
          )}

          {/* Role Tabs */}
          <div className="p-6 pt-4">
            <div className="grid grid-cols-2 p-1 bg-stone-100 rounded-xl mb-5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setLoginTab('member')}
                className={`py-2 rounded-lg transition ${
                  loginTab === 'member'
                    ? 'bg-emerald-900 text-white shadow'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Khidmat Member
              </button>
              <button
                type="button"
                onClick={() => setLoginTab('admin')}
                className={`py-2 rounded-lg transition ${
                  loginTab === 'admin'
                    ? 'bg-emerald-900 text-white shadow'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Central Admin
              </button>
            </div>

            {/* MEMBER LOGIN FORM */}
            {loginTab === 'member' && (
              <form onSubmit={handleMemberLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">
                    8-Digit ITS Number
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={8}
                      pattern="\d{8}"
                      placeholder="e.g. 30456789"
                      value={loginIts}
                      onChange={e => setLoginIts(e.target.value.replace(/\D/g, ''))}
                      className="w-full border border-stone-300 px-3.5 py-2.5 rounded-xl text-sm font-semibold tracking-wider text-stone-800 focus:ring-2 focus:ring-emerald-700 focus:outline-none"
                      required
                    />
                    <span className="absolute right-3 top-2.5 text-[11px] text-stone-400 font-mono">
                      @siddhpur.com
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-400 mt-1">Enter your 8-digit community ITS ID.</p>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs font-bold text-stone-700">
                      Password
                    </label>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded">
                      Default: 786110
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type={showMemberPassword ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={e => setLoginPassword(e.target.value)}
                      className="w-full border border-stone-300 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-stone-800 focus:ring-2 focus:ring-emerald-700 focus:outline-none"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowMemberPassword(!showMemberPassword)}
                      className="absolute right-3 top-2.5 text-xs text-stone-500 hover:text-stone-800"
                    >
                      {showMemberPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <p className="text-[11px] text-stone-400 mt-1">
                    Default password for all khidmat members is <strong className="text-stone-600">786110</strong>.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-emerald-900 hover:bg-emerald-800 text-white text-sm font-bold rounded-xl transition shadow disabled:opacity-50 mt-2"
                >
                  {loading ? 'Verifying ITS...' : 'Log In as Khidmat Member'}
                </button>
              </form>
            )}

            {/* CENTRAL ADMIN LOGIN FORM */}
            {loginTab === 'admin' && (
              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">
                    Admin Login Identifier
                  </label>
                  <input
                    type="text"
                    value={adminEmail}
                    onChange={e => setAdminEmail(e.target.value)}
                    className="w-full border border-stone-300 px-3.5 py-2.5 rounded-xl text-sm text-stone-800 focus:ring-2 focus:ring-emerald-700 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">
                    Admin Unique Password
                  </label>
                  <div className="relative">
                    <input
                      type={showAdminPassword ? 'text' : 'password'}
                      placeholder="Enter Admin Password"
                      value={adminPassword}
                      onChange={e => setAdminPassword(e.target.value)}
                      className="w-full border border-stone-300 px-3.5 py-2.5 rounded-xl text-sm text-stone-800 focus:ring-2 focus:ring-emerald-700 focus:outline-none"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowAdminPassword(!showAdminPassword)}
                      className="absolute right-3 top-2.5 text-xs text-stone-500 hover:text-stone-800"
                    >
                      {showAdminPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <p className="text-[11px] text-stone-400 mt-1">Requires confidential Central Admin password.</p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-stone-900 text-sm font-bold rounded-xl transition shadow disabled:opacity-50 mt-2"
                >
                  {loading ? 'Authenticating Admin...' : 'Log In as Central Admin'}
                </button>
              </form>
            )}
          </div>

          <div className="bg-stone-50 px-6 py-3 border-t border-stone-100 text-center">
            <p className="text-[11px] text-stone-400">
              Need assistance? Contact <span className="font-semibold text-stone-600">Markaz Central Admin</span>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================
  // VIEW: MAIN PORTAL (LOGGED IN)
  // =========================================================
  return (
    <div className="min-h-screen bg-stone-50 pb-12">
      {/* Header */}
      <header className="bg-emerald-900 text-white shadow sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold font-fatimi text-amber-300">Huzurala TUS Tashreef Aavri Siddhpur</h1>
            <p className="text-[11px] text-emerald-200">Al Jamea tus Saifiyah — Tayyari Portal</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <span className="block text-xs font-semibold leading-tight">{currentUser.full_name}</span>
              <span className="text-[10px] text-emerald-300">
                {currentUser.its_number ? `ITS: ${currentUser.its_number}` : role.toUpperCase()}
              </span>
            </div>
            <button 
              onClick={handleLogout} 
              className="text-xs bg-rose-700 hover:bg-rose-800 px-3.5 py-1.5 rounded-full font-bold transition shadow"
            >
              Exit Portal
            </button>
          </div>
        </div>
        <div className="bg-amber-400 text-stone-900 text-center py-1 text-xs font-semibold flex items-center justify-center gap-2">
          <span>🔔 Reminder: Update your task completion % and submit daily logs before 10:00 PM.</span>
          <button onClick={fetchData} className="underline text-[11px] font-bold hover:text-stone-700 ml-2">↻ Sync</button>
        </div>
      </header>

      {/* Alert Banner */}
      {alertBanner && (
        <div className={`max-w-6xl mx-auto mt-4 px-4 py-3 rounded-xl text-xs font-medium flex justify-between items-center shadow-sm ${
          alertBanner.type === 'error' ? 'bg-rose-100 text-rose-900 border border-rose-300' :
          alertBanner.type === 'warning' ? 'bg-amber-100 text-amber-900 border border-amber-300' :
          'bg-emerald-100 text-emerald-900 border border-emerald-300'
        }`}>
          <span>{alertBanner.message}</span>
          <button onClick={() => setAlertBanner(null)} className="font-bold text-sm ml-4">✕</button>
        </div>
      )}

      <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        {/* Progress & Countdown Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-stone-200 flex flex-col items-center justify-center text-center shadow-sm">
            <span className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Overall Tayyari Completion</span>
            <div className="w-28 h-28 flex items-center justify-center rounded-full bg-stone-50 border-8 border-emerald-700 shadow-inner">
              <span className="text-3xl font-extrabold text-emerald-900">{overallPercentage}%</span>
            </div>
            <span className="text-[11px] text-stone-400 mt-2">Live average across {tasks.length} task{tasks.length === 1 ? '' : 's'}</span>
          </div>

          <div className="md:col-span-2 bg-gradient-to-r from-emerald-900 to-teal-900 text-white p-5 rounded-2xl flex flex-col justify-between shadow-sm">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-semibold text-amber-300 font-fatimi">Preparation Timeline Tracker</h3>
                <p className="text-xs text-emerald-200">Countdown to Tashreef Aavri</p>
              </div>
              {role === 'admin' && (
                <button onClick={exportReport} className="text-xs bg-amber-400 hover:bg-amber-300 text-stone-900 font-bold px-3 py-1.5 rounded-lg transition shadow">
                  Export CSV Report
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 my-3 text-center">
              <div className="bg-white/10 p-2.5 rounded-xl backdrop-blur-sm">
                <span className="block text-2xl font-bold">{daysElapsed}</span>
                <span className="text-[11px] text-emerald-200">Days Elapsed</span>
              </div>
              <div className="bg-white/10 p-2.5 rounded-xl backdrop-blur-sm">
                <span className="block text-2xl font-bold text-amber-300">{daysLeft}</span>
                <span className="text-[11px] text-emerald-200">Days Remaining</span>
              </div>
              <div className="bg-white/10 p-2.5 rounded-xl backdrop-blur-sm">
                <span className="block text-2xl font-bold">{totalDays}</span>
                <span className="text-[11px] text-emerald-200">Total Allotted</span>
              </div>
            </div>
          </div>
        </div>

        {/* ADMIN MANAGEMENT SECTION */}
        {role === 'admin' && (
          <div className="space-y-4">
            {/* Team Directory & Member Provisioning */}
            <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h3 className="text-base font-bold text-emerald-900 font-fatimi">Khidmat Team Directory</h3>
                  <p className="text-[11px] text-stone-500">
                    {profiles.length} registered member{profiles.length === 1 ? '' : 's'} (Login: 8-digit ITS | PWD: 786110)
                  </p>
                </div>
                <button 
                  onClick={() => setShowAddMember(!showAddMember)} 
                  className="text-xs bg-emerald-800 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition font-semibold"
                >
                  {showAddMember ? 'Close Form' : '+ Add Team Member'}
                </button>
              </div>

              {/* Add Member Form */}
              {showAddMember && (
                <form onSubmit={handleAddMember} className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-3 border-t border-stone-200 mb-4">
                  <input 
                    type="text" 
                    placeholder="Full Name *" 
                    value={memberForm.full_name} 
                    onChange={e => setMemberForm({ ...memberForm, full_name: e.target.value })} 
                    className="border p-2 rounded-lg text-xs focus:ring-1 focus:ring-emerald-700 outline-none" 
                    required 
                  />
                  <input 
                    type="text" 
                    maxLength={8}
                    pattern="\d{8}"
                    placeholder="8-Digit ITS ID *" 
                    value={memberForm.its_number} 
                    onChange={e => setMemberForm({ ...memberForm, its_number: e.target.value.replace(/\D/g, '') })} 
                    className="border p-2 rounded-lg text-xs focus:ring-1 focus:ring-emerald-700 outline-none font-mono" 
                    required 
                  />
                  <input 
                    type="text" 
                    placeholder="Mobile / WhatsApp" 
                    value={memberForm.phone} 
                    onChange={e => setMemberForm({ ...memberForm, phone: e.target.value })} 
                    className="border p-2 rounded-lg text-xs focus:ring-1 focus:ring-emerald-700 outline-none" 
                  />
                  <select
                    value={memberForm.role}
                    onChange={e => setMemberForm({ ...memberForm, role: e.target.value })}
                    className="border p-2 rounded-lg text-xs focus:ring-1 focus:ring-emerald-700 outline-none bg-white"
                  >
                    <option value="member">Role: Member</option>
                    <option value="admin">Role: Admin</option>
                  </select>
                  <button 
                    type="submit" 
                    disabled={loading} 
                    className="bg-emerald-800 text-white font-bold text-xs rounded-lg hover:bg-emerald-700 transition py-2 disabled:opacity-50"
                  >
                    {loading ? 'Provisioning...' : 'Save & Provision'}
                  </button>
                </form>
              )}

              {/* Members Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-stone-600">
                  <thead className="bg-stone-50 text-stone-500 font-bold uppercase text-[10px] tracking-wider border-b">
                    <tr>
                      <th className="py-2.5 px-3">Name</th>
                      <th className="py-2.5 px-3">8-Digit ITS (Login ID)</th>
                      <th className="py-2.5 px-3">Supabase Email</th>
                      <th className="py-2.5 px-3">Default Password</th>
                      <th className="py-2.5 px-3">Role</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {profiles.map(p => (
                      <tr key={p.id} className="hover:bg-stone-50/80">
                        <td className="py-2 px-3 font-semibold text-stone-800">{p.full_name}</td>
                        <td className="py-2 px-3">
                          {p.its_number ? (
                            <span className="font-mono bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded font-bold">
                              {p.its_number}
                            </span>
                          ) : (
                            <button
                              onClick={() => handleAssignIts(p.id, p.full_name)}
                              className="text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded text-[11px] font-bold"
                            >
                              ⚠️ Assign ITS
                            </button>
                          )}
                        </td>
                        <td className="py-2 px-3 text-stone-400 font-mono text-[11px]">
                          {p.its_number ? `${p.its_number}@siddhpur.com` : '—'}
                        </td>
                        <td className="py-2 px-3">
                          <span className="bg-stone-100 text-stone-700 px-1.5 py-0.5 rounded font-mono text-[11px]">
                            {DEFAULT_MEMBER_PASSWORD}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                            p.role === 'admin' ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-600'
                          }`}>
                            {p.role || 'member'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={() => handleDeleteMember(p.id, p.full_name)}
                            className="text-rose-600 hover:text-rose-800 text-[11px] font-bold"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Deploy Task Form */}
            <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
              <h3 className="text-base font-bold text-emerald-900 mb-3 font-fatimi">Deploy New Khidmat Task</h3>
              <form onSubmit={handleCreateTask} className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input 
                  type="text" 
                  placeholder="Task Name (e.g. Stage Tazyeen) *" 
                  value={taskForm.title} 
                  onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} 
                  className="border p-2 rounded-lg text-xs focus:ring-1 focus:ring-emerald-700 outline-none" 
                  required 
                />
                <input 
                  type="text" 
                  placeholder="Description / Instructions" 
                  value={taskForm.description} 
                  onChange={e => setTaskForm({ ...taskForm, description: e.target.value })} 
                  className="border p-2 rounded-lg text-xs focus:ring-1 focus:ring-emerald-700 outline-none" 
                />
                <select 
                  value={taskForm.assigned_to} 
                  onChange={e => setTaskForm({ ...taskForm, assigned_to: e.target.value })} 
                  className="border p-2 rounded-lg text-xs focus:ring-1 focus:ring-emerald-700 outline-none bg-white"
                >
                  <option value="">Assign To...</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} {p.its_number ? `(${p.its_number})` : ''}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <input 
                    type="date" 
                    value={taskForm.due_date} 
                    onChange={e => setTaskForm({ ...taskForm, due_date: e.target.value })} 
                    className="border p-2 rounded-lg text-xs w-full focus:ring-1 focus:ring-emerald-700 outline-none bg-white" 
                    required 
                  />
                  <button 
                    type="submit" 
                    disabled={loading} 
                    className="bg-emerald-800 text-white px-4 rounded-lg text-xs font-bold hover:bg-emerald-700 transition disabled:opacity-50"
                  >
                    {loading ? '...' : 'Assign'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* TASK CARDS SECTION */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-bold text-stone-800 font-fatimi">
              {role === 'admin' ? "Active Khidmat Tasks" : "My Assigned Tasks"}
            </h2>
            <span className="text-xs text-stone-500 font-medium">
              Click any task to submit daily work log & notes
            </span>
          </div>

          {tasks.filter(t => role === 'admin' || t.assigned_to === currentUser.id).length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-stone-200 text-center text-stone-400">
              <p className="text-sm">No tasks assigned to your view.</p>
              <p className="text-xs mt-1 text-stone-400">
                {role === 'admin' ? 'Deploy a new task above to get started.' : 'No tasks assigned to your profile yet.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {tasks
                .filter(t => role === 'admin' || t.assigned_to === currentUser.id)
                .map(t => {
                  const percent = Number(t.progress_percent) || 0;
                  const hasDueDate = !!t.due_date;
                  const isDelayed = hasDueDate && percent < 50 && new Date(t.due_date) < new Date(Date.now() + 3*24*60*60*1000);
                  const isCompleted = percent >= 100;

                  return (
                    <div 
                      key={t.id} 
                      onClick={() => openTaskDetails(t)} 
                      className="bg-white p-4 rounded-2xl border border-stone-200 hover:border-emerald-600 cursor-pointer transition shadow-sm hover:shadow flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex justify-between items-start mb-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isCompleted ? 'bg-emerald-100 text-emerald-800' :
                            isDelayed ? 'bg-rose-100 text-rose-700' : 
                            'bg-blue-50 text-blue-700'
                          }`}>
                            {isCompleted ? 'Completed' : isDelayed ? 'Needs Support' : 'On Track'}
                          </span>
                          <span className="text-[11px] text-stone-400">Due: {t.due_date || 'N/A'}</span>
                        </div>
                        <h4 className="font-bold text-stone-900 text-sm mb-1">{t.title}</h4>
                        <p className="text-xs text-stone-500 mb-3 line-clamp-2">{t.description || 'No description provided.'}</p>
                        <p className="text-xs font-semibold text-emerald-800">
                          Assigned: {t.profiles?.full_name || 'Unassigned'} {t.profiles?.its_number ? `(${t.profiles.its_number})` : ''}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-stone-100">
                        <div className="flex justify-between text-xs font-bold text-stone-700 mb-1">
                          <span>Progress</span>
                          <span>{percent}%</span>
                        </div>
                        <div className="w-full bg-stone-100 h-2 rounded-full overflow-hidden">
                          <div 
                            className={`h-2 rounded-full transition-all duration-300 ${isCompleted ? 'bg-emerald-600' : isDelayed ? 'bg-amber-500' : 'bg-emerald-600'}`} 
                            style={{ width: `${percent}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* TASK DETAILS & UPDATE MODAL */}
        {selectedTask && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
              <button 
                onClick={() => setSelectedTask(null)} 
                className="absolute top-4 right-4 text-stone-400 hover:text-stone-800 text-base font-bold"
              >
                ✕
              </button>
              <h3 className="text-lg font-bold text-emerald-900 mb-1 font-fatimi">{selectedTask.title}</h3>
              <p className="text-xs text-stone-500 mb-4">{selectedTask.description || 'No detailed instructions.'}</p>

              <form onSubmit={handleLogSubmit} className="space-y-3 bg-stone-50 p-4 rounded-xl border border-stone-200 mb-5">
                <h4 className="font-bold text-xs text-stone-800">Update Completion % & Daily Work Log</h4>
                <div>
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span>Task Completion</span>
                    <span className="text-emerald-800 font-extrabold">{newLog.percent}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={newLog.percent} 
                    onChange={e => setNewLog({ ...newLog, percent: Number(e.target.value) })} 
                    className="w-full accent-emerald-700" 
                  />
                </div>
                <textarea 
                  rows="2" 
                  placeholder="Summary of work completed today..." 
                  value={newLog.summary} 
                  onChange={e => setNewLog({ ...newLog, summary: e.target.value })} 
                  className="w-full border p-2 rounded-lg text-xs focus:ring-1 focus:ring-emerald-700 outline-none bg-white" 
                  required 
                />
                <div className="flex items-center gap-2">
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={e => setNewLog({ ...newLog, file: e.target.files[0] })} 
                    className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[11px] file:bg-emerald-100 file:text-emerald-800 cursor-pointer" 
                  />
                  <button 
                    type="submit" 
                    disabled={loading} 
                    className="ml-auto bg-emerald-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-emerald-700 transition disabled:opacity-50"
                  >
                    {loading ? 'Saving...' : 'Save Log'}
                  </button>
                </div>
              </form>

              <div>
                <h4 className="font-bold text-xs text-stone-800 mb-2">Discussion & Coordination Thread</h4>
                <div className="max-h-36 overflow-y-auto space-y-1.5 mb-3 border border-stone-200 p-2.5 rounded-lg bg-stone-50">
                  {threads.length === 0 ? (
                    <p className="text-[11px] text-stone-400 italic">No notes yet. Post a coordination update below.</p>
                  ) : (
                    threads.map(m => (
                      <div key={m.id} className="text-xs text-stone-800 bg-white p-2 rounded border border-stone-100 shadow-xs">
                        {m.message}
                      </div>
                    ))
                  )}
                </div>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Type a message..." 
                    value={newMsg} 
                    onChange={e => setNewMsg(e.target.value)} 
                    onKeyDown={e => { if (e.key === 'Enter') handleSendMessage(e); }}
                    className="border p-2 rounded-lg text-xs flex-1 focus:ring-1 focus:ring-emerald-700 outline-none bg-white" 
                  />
                  <button 
                    onClick={handleSendMessage} 
                    className="bg-stone-800 text-white text-xs px-3 rounded-lg font-semibold hover:bg-stone-700 transition"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
