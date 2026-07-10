<script lang="ts">
  import { supabase } from '$lib/supabase/client';
  import { createDb } from '$lib/supabase/queries';
  import type { IncidentType, IncidentAction } from '$lib/data/incidents';
  import { page } from '$app/stores';

  let { data } = $props();
  let currentTab = $state<'types' | 'actions'>('types');
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let confirmDeleteId = $state<string | null>(null);
  let showAdd = $state(false);
  let newName = $state('');

  const db = createDb(supabase);

  async function refresh() {
    window.location.reload();
  }

  async function add() {
    if (currentTab === 'types') {
      await db.addIncidentType(newName);
    } else {
      await db.addIncidentAction(newName);
    }
    newName = '';
    showAdd = false;
    refresh();
  }

  async function updateItem() {
    if (!editingId) return;
    const table = currentTab === 'types' ? 'incident_types' : 'incident_actions';
    const { error } = await supabase
      .from(table)
      .update({ name: editName.trim().toUpperCase() })
      .eq('id', editingId);
    if (error) console.error(error);
    editingId = null;
    editName = '';
    refresh();
  }

  async function deleteItem(id: string) {
    const table = currentTab === 'types' ? 'incident_types' : 'incident_actions';
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) console.error(error);
    confirmDeleteId = null;
    refresh();
  }

  function setConfirmDelete(id: string) {
    confirmDeleteId = id;
  }

  $effect(() => {
    page.subscribe(() => {});
  });
</script>

<svelte:head>
  <title>Dropdowns | JCH Incident Tracker</title>
</svelte:head>

<div class="min-h-screen bg-warm-50 p-8">
  <div class="mx-auto max-w-4xl">
    <div class="mb-8 flex items-center gap-4">
      <a href="/admin" class="text-sm text-accent-600 hover:text-accent-700">&larr; Back to Admin</a>
      <h1 class="text-3xl font-bold text-warm-800">Manage Dropdown Values</h1>
    </div>

    <div class="mb-8">
      <div class="tabs tabs-boxed">
        <a class="tab {currentTab === 'types' ? 'active' : ''}" onclick={() => currentTab = 'types'}>Incident Types</a> 
        <a class="tab {currentTab === 'actions' ? 'active' : ''}" onclick={() => currentTab = 'actions'}>Action Statuses</a> 
      </div>
    </div>

    {#if showAdd}
      <div class="mb-8 rounded-lg bg-white p-6 shadow-sm">
        <h2 class="mb-4 text-xl font-semibold text-warm-800">Add New {currentTab === 'types' ? 'Type' : 'Action Status'}</h2>
        <div class="flex gap-3">
          <input
            bind:value={newName}
            class="flex-1 rounded-lg border border-warm-200 px-4 py-2 text-sm input-focus"
            placeholder="Enter name (e.g. NEW TYPE)"
          />
          <button
            class="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            onclick={add}
          >
            Add
          </button>
          <button
            class="rounded-lg border border-warm-400 px-6 py-2 text-sm text-warm-700 hover:bg-warm-50"
            onclick={() => (showAdd = false)}
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}

    <div class="rounded-lg border border-warm-200 bg-white shadow-sm">
      {#if currentTab === 'types'}
        {#if data.incidentTypes?.length}
          <table class="w-full divide-y divide-warm-200 text-sm">
            <thead class="bg-warm-50">
              <tr>
                <th class="px-6 py-4 text-left font-medium text-warm-500">Name</th>
                <th class="px-6 py-4 text-right font-medium text-warm-500">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-warm-100">
              {#each data.incidentTypes as item}
                <tr>
                  <td class="px-6 py-4">
                    {#if editingId === item.id}
                      <input
                        bind:value={editName}
                        class="w-full rounded border border-warm-300 px-3 py-1.5 text-sm input-focus"
                      />
                    {:else}
                      <div class="font-mono text-lg uppercase text-warm-800">{item.name}</div>
                    {/if}
                  </td>
                  <td class="px-6 py-4 text-right">
                    {#if editingId === item.id}
                      <button
                        class="mr-3 rounded px-3 py-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
                        onclick={updateItem}
                      >
                        Save
                      </button>
                      <button
                        class="rounded px-3 py-1 text-xs font-medium text-gray-500 hover:text-gray-700"
                        onclick={() => (editingId = null)}
                      >
                        Cancel
                      </button>
                    {:else}
                      <button
                        class="mr-3 rounded-lg px-3 py-1 border border-warm-300 text-sm font-medium text-accent-600 hover:bg-warm-50 hover:text-accent-700 transition-all"
                        onclick={() => {
                          editingId = item.id;
                          editName = item.name;
                        }}
                      >
                        Edit
                      </button>
                      {#if confirmDeleteId === item.id}
                        <span class="mr-2 text-xs text-red-600">Confirm delete?</span>
                        <button
                          class="mr-1 rounded px-2 py-0.5 text-xs bg-red-600 text-white hover:bg-red-700"
                          onclick={() => deleteItem(item.id)}
                        >
                          Yes
                        </button>
                        <button
                          class="px-2 py-0.5 text-xs text-warm-600 hover:text-warm-800"
                          onclick={() => confirmDeleteId = null}
                        >
                          No
                        </button>
                      {:else}
                        <button
                          class="rounded-lg px-3 py-1 border border-red-200 text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 transition-all"
                          onclick={() => setConfirmDelete(item.id)}
                        >
                          Delete
                        </button>
                      {/if}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="p-8 text-center text-warm-500">No incident types found.</p>
        {/if}
      {/if}

      {#if currentTab === 'actions'}
        {#if data.incidentActions?.length}
          <table class="w-full divide-y divide-warm-200 text-sm">
            <thead class="bg-warm-50">
              <tr>
                <th class="px-6 py-4 text-left font-medium text-warm-500">Name</th>
                <th class="px-6 py-4 text-right font-medium text-warm-500">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-warm-100">
              {#each data.incidentActions as item}
                <tr>
                  <td class="px-6 py-4">
                    {#if editingId === item.id}
                      <input
                        bind:value={editName}
                        class="w-full rounded border border-warm-300 px-3 py-1.5 text-sm input-focus"
                      />
                    {:else}
                      <div class="font-mono text-lg uppercase text-warm-800">{item.name}</div>
                    {/if}
                  </td>
                  <td class="px-6 py-4 text-right">
                    {#if editingId === item.id}
                      <button
                        class="mr-3 rounded px-3 py-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
                        onclick={updateItem}
                      >
                        Save
                      </button>
                      <button
                        class="rounded px-3 py-1 text-xs font-medium text-gray-500 hover:text-gray-700"
                        onclick={() => (editingId = null)}
                      >
                        Cancel
                      </button>
                    {:else}
                      <button
                        class="mr-3 rounded-lg px-3 py-1 border border-warm-300 text-sm font-medium text-accent-600 hover:bg-warm-50 hover:text-accent-700 transition-all"
                        onclick={() => {
                          editingId = item.id;
                          editName = item.name;
                        }}
                      >
                        Edit
                      </button>
                      {#if confirmDeleteId === item.id}
                        <span class="mr-2 text-xs text-red-600">Confirm delete?</span>
                        <button
                          class="mr-1 rounded px-2 py-0.5 text-xs bg-red-600 text-white hover:bg-red-700"
                          onclick={() => deleteItem(item.id)}
                        >
                          Yes
                        </button>
                        <button
                          class="px-2 py-0.5 text-xs text-warm-600 hover:text-warm-800"
                          onclick={() => confirmDeleteId = null}
                        >
                          No
                        </button>
                      {:else}
                        <button
                          class="rounded-lg px-3 py-1 border border-red-200 text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 transition-all"
                          onclick={() => setConfirmDelete(item.id)}
                        >
                          Delete
                        </button>
                      {/if}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="p-8 text-center text-warm-500">No action statuses found.</p>
        {/if}
      {/if}
    </div>

    <div class="mt-8 flex justify-center">
      <button
        class="rounded-lg bg-accent-600 px-8 py-3 text-lg font-medium text-white hover:bg-accent-500"
        onclick={() => showAdd = true}
      >
        + Add New {currentTab === 'types' ? 'Type' : 'Action Status'}
      </button>
    </div>
  </div>
</div>

<style>
  .tabs {
    border-bottom: 1px solid rgb(252 245 243 / 0.5);
  }
  .tab {
    position: relative;
    bottom: -1px;
    padding: 0.75rem 1.5rem;
    background: transparent;
    border: 1px solid rgb(252 245 243 / 0.5);
    border-bottom: none;
    font-weight: 500;
    color: rgb(120 113 108);
    cursor: pointer;
    transition: all 0.2s;
  }
  .tab:hover {
    color: rgb(120 113 108);
  }
  .tab.active {
    color: rgb(0 120 212);
    background: white;
    border-color: rgb(252 245 243 / 0.5);
    border-top-color: rgb(252 245 243 / 0.5);
    box-shadow: 0 -2px 4px rgb(0 0 0 / 0.05);
  }
</style>