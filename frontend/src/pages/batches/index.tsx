import { CreateBatchDialog } from './components/CreateBatchDialog'
import { BatchDetailView } from './components/BatchDetailView'
import { BatchListView } from './components/BatchListView'
import { useBatchesPage } from './hooks/useBatchesPage'

export default function Batches() {
  const state = useBatchesPage()

  if (state.selectedBatch) {
    return (
      <BatchDetailView
        toast={state.toast}
        setToast={state.setToast}
        selectedBatch={state.selectedBatch}
        setSelectedBatch={state.setSelectedBatch}
        detailTab={state.detailTab}
        setDetailTab={state.setDetailTab}
        students={state.students}
        studentsLoading={state.studentsLoading}
        files={state.files}
        filesLoading={state.filesLoading}
        artifacts={state.artifacts}
        artifactSummary={state.artifactSummary}
        artifactsLoading={state.artifactsLoading}
        fileUploading={state.fileUploading}
        fileInputRef={state.fileInputRef}
        studentForm={state.studentForm}
        setStudentForm={state.setStudentForm}
        addingStudent={state.addingStudent}
        csvUploading={state.csvUploading}
        handleDeleteBatch={state.handleDeleteBatch}
        handleAddStudent={state.handleAddStudent}
        handleRemoveStudent={state.handleRemoveStudent}
        handleCsvUpload={state.handleCsvUpload}
        handleFileUpload={state.handleFileUpload}
        handleDeleteFile={state.handleDeleteFile}
        handleRefreshFiles={state.handleRefreshFiles}
        handleDeleteArtifact={state.handleDeleteArtifact}
        refreshArtifacts={state.refreshArtifacts}
        isEditOpen={state.isEditOpen}
        editDetails={state.editDetails}
        setEditDetails={state.setEditDetails}
        isSavingEdit={state.isSavingEdit}
        openEditDialog={state.openEditDialog}
        closeEditDialog={state.closeEditDialog}
        handleSaveBatchDetails={state.handleSaveBatchDetails}
      />
    )
  }

  return (
    <>
      <CreateBatchDialog
        isCreateOpen={state.isCreateOpen}
        createStep={state.createStep}
        setCreateStep={state.setCreateStep}
        batchDetails={state.batchDetails}
        setBatchDetails={state.setBatchDetails}
        manualStudents={state.manualStudents}
        setManualStudents={state.setManualStudents}
        csvStudents={state.csvStudents}
        csvFileName={state.csvFileName}
        tempName={state.tempName}
        setTempName={state.setTempName}
        tempEmail={state.tempEmail}
        setTempEmail={state.setTempEmail}
        isSubmitting={state.isSubmitting}
        csvError={state.csvError}
        createStatus={state.createStatus}
        closeCreateDialog={state.closeCreateDialog}
        isDetailsComplete={state.isDetailsComplete}
        handleCreateWithStudents={state.handleCreateWithStudents}
        handleAddManualStudent={state.handleAddManualStudent}
        handleCsvFileSelect={state.handleCsvFileSelect}
      />
      <BatchListView
        toast={state.toast}
        setToast={state.setToast}
        searchQuery={state.searchQuery}
        setSearchQuery={state.setSearchQuery}
        filteredBatches={state.filteredBatches}
        batches={state.batches}
        listLoading={state.listLoading}
        listError={state.listError}
        openCreateDialog={state.openCreateDialog}
        setSelectedBatch={state.setSelectedBatch}
        handleDeleteBatch={state.handleDeleteBatch}
      />
    </>
  )
}
