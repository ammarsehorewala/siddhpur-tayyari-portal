import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';

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
  const [alertBanner, setAlertBanner] = useState(null); // { type: 'success'|'error'|'warning', message: '' }

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
    fetchData();

    // Set up Realtime listener for live synchronization across users
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
        showAlert(`Error loading tasks: ${tErr.message}`, 'error');
      } else if (tData) {
        setTasks(tData);
      }

      const { data: pData, error: pErr } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name', { ascending: true });

      if (pErr) {
        console.error('Error fetching profiles:', pErr);
        showAlert(`Error loading profiles: ${pErr.message}`, 'error');
      } else if (pData) {
        setProfiles(pData);
      }
    } catch (err) {
      console.error('Unexpected error fetching data:', err);
      showAlert(`Network/Connection error: ${err.message}`, 'error');
    }
  }

  const overallPercentage = tasks.length === 0
    ? 0
    : Math.round(tasks.reduce((acc, t) => acc + (Number(t.progress_percent) || 0), 0) / tasks.length);

  async function handleAddMember(e) {
    e.preventDefault();
    if (!memberForm.full_name.trim()) return;
    setLoading(true);

    try {
      const { error } = await supabase.from('profiles').insert([{
        full_name: memberForm.full_name.trim(),
        its_number: memberForm.its_number.trim() || null,
        phone: memberForm.phone.trim() || null,
        role: memberForm.role
      }]);

      if (error) {
        console.error('Error creating member:', error);
        showAlert(`Failed to add member: ${error.message}`, 'error');
      } else {
        setMemberForm({ full_name: '', its_number: '', phone: '', role: 'member' });
        setShowAddMember(false);
        showAlert('Team member added successfully!', 'success');
        fetchData();
      }
    } catch (err) {
      console.error('Unexpected error:', err);
      showAlert(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

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
        console.error('Error creating task:', error);
        showAlert(`Failed to create task: ${error.message}`, 'error');
      } else {
        setTaskForm({ title: '', description: '', assigned_to: '', due_date: '' });
        showAlert('Khidmat task deployed successfully!', 'success');
        fetchData();
      }
    } catch (err) {
      console.error('Unexpected error:', err);
      showAlert(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function openTaskDetails(task) {
    setSelectedTask(task);
    setNewLog({ summary: '', percent: task.progress_percent || 0, file: null });
    try {
      const { data, error } = await supabase
        .from('task_threads')
        .select('*')
        .eq('task_id', task.id)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching threads:', error);
      } else {
        setThreads(data || []);
      }
    } catch (err) {
      console.error('Unexpected thread fetch error:', err);
    }
  }

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
          console.warn('Storage upload error (bucket may not exist):', uploadError.message);
          showAlert(
            `Log saved, but photo upload skipped (${uploadError.message}). Ensure bucket 'progress-photos' is created in Supabase Storage.`,
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
      console.error('Unexpected log submit error:', err);
      showAlert(`Error saving log: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!newMsg.trim() || !selectedTask) return;

    try {
      const messageContent = `${currentUser?.full_name || 'Anonymous'}: ${newMsg.trim()}`;
      const { error } = await supabase.from('task_threads').insert([{
        task_id: selectedTask.id,
        sender_id: currentUser?.id || null,
        message: messageContent
      }]);

      if (error) {
        showAlert(`Could not send message: ${error.message}`, 'error');
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
      console.error('Unexpected send message error:', err);
    }
  }

  function exportReport() {
    let csv = "Task Name,Assigned To,Progress %,Due Date\n";
    tasks.forEach(t => {
      csv += `"${t.title.replace(/"/g, '""')}","${t.profiles?.full_name || 'Unassigned'}","${t.progress_percent || 0}%","${t.due_date || 'No Date'}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Siddhpur-Tayyari-Report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  // --- LOGIN / PERSONA SELECTOR ---
  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-900 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border-t-8 border-emerald-700">
          <h1 className="text-3xl font-bold font-fatimi text-emerald-900 mb-1">أهلاً وسهلاً</h1>
          <h2 className="text-lg font-semibold text-stone-800 mb-2">Huzurala TUS Tashreef Aavri Siddhpur</h2>
          <p className="text-stone-500 text-xs mb-6">Select your profile to access the Tayyari Portal:</p>

          {alertBanner && (
            <div className={`mb-4 p-3 rounded-lg text-xs font-semibold ${
              alertBanner.type === 'error' ? 'bg-rose-100 text-rose-800 border border-rose-200' :
              alertBanner.type === 'warning' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
              'bg-emerald-100 text-emerald-800 border border-emerald-200'
            }`}>
              {alertBanner.message}
            </div>
          )}

          <div className="space-y-3">
            <button 
              onClick={() => { 
                setCurrentUser({ id: '00000000-0000-0000-0000-000000000000', full_name: 'Markaz Central Admin' }); 
                setRole('admin'); 
              }} 
              className="w-full py-2.5 bg-emerald-900 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition shadow"
            >
              Enter as Central Admin
            </button>

            <div className="border-t pt-3">
              <div className="flex justify-between items-center mb-2">
                <p className="text-xs font-bold text-stone-400 uppercase tracking-wider">Team Member Access</p>
                <button onClick={fetchData} className="text-[11px] text-emerald-700 hover:underline">↻ Refresh</button>
              </div>

              {profiles.length > 0 ? (
                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                  {profiles.map(p => (
                    <button 
                      key={p.id} 
                      onClick={() => { setCurrentUser(p); setRole(p.role || 'member'); }} 
                      className="w-full py-2 px-3 bg-stone-100 hover:bg-emerald-50 text-stone-700 rounded-lg text-xs text-left flex justify-between items-center border border-stone-200 transition"
                    >
                      <span className="font-medium truncate">{p.full_name} {p.its_number ? `(${p.its_number})` : ''}</span>
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded ml-2 shrink-0">Enter</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="bg-stone-50 border border-stone-200 p-3 rounded-lg text-xs text-stone-500">
                  <p className="italic">No team members added yet.</p>
                  <p className="mt-1 text-[11px] text-stone-400">Log in as Central Admin to add members.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- MAIN PORTAL INTERFACE ---
  return (
    <div className="min-h-screen bg-stone-50 pb-12">
      <header className="bg-emerald-900 text-white shadow sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold font-fatimi text-amber-300">Huzurala TUS Tashreef Aavri Siddhpur</h1>
            <p className="text-[11px] text-emerald-200">Al Jamea tus Saifiyah — Tayyari Portal</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs bg-emerald-800 px-3 py-1 rounded-full border border-emerald-700">
              {currentUser.full_name} ({role.toUpperCase()})
            </span>
            <button 
              onClick={() => setCurrentUser(null)} 
              className="text-xs bg-rose-700 hover:bg-rose-800 px-3 py-1 rounded-full transition"
            >
              Exit
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

        {/* Admin Management Section */}
        {role === 'admin' && (
          <div className="space-y-4">
            <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-sm">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h3 className="text-base font-bold text-emerald-900 font-fatimi">Team Management</h3>
                  <p className="text-[11px] text-stone-500">{profiles.length} registered khidmat member{profiles.length === 1 ? '' : 's'}</p>
                </div>
                <button 
                  onClick={() => setShowAddMember(!showAddMember)} 
                  className="text-xs bg-emerald-800 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition"
                >
                  {showAddMember ? 'Close Form' : '+ Add Team Member'}
                </button>
              </div>

              {showAddMember && (
                <form onSubmit={handleAddMember} className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-3 border-t border-stone-200">
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
                    placeholder="ITS Number (optional)" 
                    value={memberForm.its_number} 
                    onChange={e => setMemberForm({ ...memberForm, its_number: e.target.value })} 
                    className="border p-2 rounded-lg text-xs focus:ring-1 focus:ring-emerald-700 outline-none" 
                  />
                  <input 
                    type="text" 
                    placeholder="Mobile / WhatsApp (optional)" 
                    value={memberForm.phone} 
                    onChange={e => setMemberForm({ ...memberForm, phone: e.target.value })} 
                    className="border p-2 rounded-lg text-xs focus:ring-1 focus:ring-emerald-700 outline-none" 
                  />
                  <button 
                    type="submit" 
                    disabled={loading} 
                    className="bg-emerald-800 text-white font-bold text-xs rounded-lg hover:bg-emerald-700 transition py-2 disabled:opacity-50"
                  >
                    {loading ? 'Saving...' : 'Save Member'}
                  </button>
                </form>
              )}
            </div>

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
                    <option key={p.id} value={p.id}>{p.full_name} {p.its_number ? `(${p.its_number})` : ''}</option>
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

        {/* Task Cards Section */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-bold text-stone-800 font-fatimi">
              {role === 'admin' ? "Active Khidmat Tasks" : "My Assigned Tasks"}
            </h2>
            <span className="text-xs text-stone-500 font-medium">
              Click any task to record progress logs or messages
            </span>
          </div>

          {tasks.filter(t => role === 'admin' || t.assigned_to === currentUser.id).length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-stone-200 text-center text-stone-400">
              <p className="text-sm">No tasks found.</p>
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
                          Assigned: {t.profiles?.full_name || 'Unassigned'}
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

        {/* Task Details & Update Modal */}
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
                  placeholder="Summary of what was completed today..." 
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
