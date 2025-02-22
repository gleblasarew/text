/**
 * @copyright Copyright (c) 2021 Julien Veyssier <eneiluj@posteo.net>
 *
 * @author Julien Veyssier <eneiluj@posteo.net>
 *
 * @license GNU AGPL version 3 or any later version
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 *
 */


import { randHash } from '../utils/'
import 'cypress-file-upload'
const randUser = randHash()
const randUser2 = randHash()
let currentUser = randUser
const attachmentFileNameToId = {}

const ACTION_UPLOAD_LOCAL_FILE = 1
const ACTION_INSERT_FROM_FILES = 2
const ACTION_INSERT_FROM_LINK = 3

/**
 * Open the image action menu and click one action
 *
 * @param actionIndex position of the action to be clicked
 * @param callback what happens once it's been clicked
 */
const clickOnImageAction = (actionIndex, callback) => {
	cy.get('#viewer .action-item.submenu')
		.should('not.have.class', 'action-item--open')
		.click()
		.should('have.class', 'action-item--open')

	// get the popover ID to be able to find the related DOM element
	cy.get('#viewer .action-item.submenu > div.v-popover > .trigger')
		.should('have.attr', 'aria-describedby')
			.should('contain', 'popover_')
			.then((popoverId) => {
				cy.log('Click on the action entry')
				cy.get('div#' + popoverId)
					.should('have.class', 'open')
					.find('li:nth-child(' + actionIndex + ')').click()
				// our job here is done
				callback(popoverId)
			})
}

/**
 * Check if an image is visible in the document
 *
 * @param documentId file ID of the current document
 * @param imageName file name to be checked
 */
const checkImage = (documentId, imageName, imageId) => {
	cy.log('Check the image is visible and well formed')
	cy.get('#editor .ProseMirror div.image[data-src="text://image?imageFileName=' + imageName + '"]')
		.should('be.visible')
		.find('img')
			.should('have.attr', 'src')
				.should('contain', 'apps/text/image?documentId=' + documentId)
				.should('contain', 'imageFileName=' + imageName)
	// keep track that we have created this image in the attachment dir
	attachmentFileNameToId[imageName] = imageId
}

/**
 * Wait for the image insertion request to finish and check if the image is visible
 *
 * @param requestAlias Alias of the request we are waiting for
 */
const waitForRequestAndCheckImage = (requestAlias) => {
	cy.wait('@' + requestAlias).then((req) => {
		// the name of the created file on NC side is returned in the response
		const fileId = req.response.body.id
		const fileName = req.response.body.name
		const documentId = req.response.body.documentId
		checkImage(documentId, fileName, fileId)
		cy.screenshot()
	})
}

describe('Test all image insertion methods', () => {
	before(() => {
		// Init user
		cy.nextcloudCreateUser(randUser, 'password')
		cy.login(randUser, 'password')

		// Upload test files to user's storage
		cy.uploadFile('test.md', 'text/markdown')
		cy.uploadFile('github.png', 'image/png')

		cy.nextcloudCreateUser(randUser2, 'password')
		cy.shareFileToUser(randUser, 'password', 'test.md', randUser2)
	})

	beforeEach(() => {
		cy.login(currentUser, 'password')
	})

	it('See test files in the list and display hidden files', () => {
		cy.get('#fileList tr[data-file="test.md"]', { timeout: 10000 })
			.should('contain', 'test.md')
		cy.get('#fileList tr[data-file="github.png"]', { timeout: 10000 })
			.should('contain', 'github.png')

		cy.get('#app-settings-header', { timeout: 10000 })
			.click()
		cy.intercept({ method: 'POST', url: '**/showhidden' }).as('showHidden')
		cy.get('#app-settings-content label[for=showhiddenfilesToggle]', { timeout: 10000 })
			.click()
		cy.wait('@showHidden')
	})

	it('Insert an image from files', () => {
		cy.openFile('test.md')
		clickOnImageAction(ACTION_INSERT_FROM_FILES, () => {
			const requestAlias = 'insertPathRequest'
			cy.intercept({ method: 'POST', url: '**/filepath' }).as(requestAlias)

			cy.log('Select the file in the filepicker')
			cy.get('#picker-filestable tr[data-entryname="github.png"]').click()
			cy.log('Click OK in the filepicker')
			cy.get('.oc-dialog > .oc-dialog-buttonrow button').click()

			waitForRequestAndCheckImage(requestAlias)
		})
	})

	it('Upload a local image', () => {
		cy.openFile('test.md')
		// in this case we almost could just attach the file to the input
		// BUT we still need to click on the action because otherwise the command
		// is not handled correctly when the upload has been done in <MenuBar>
		clickOnImageAction(ACTION_UPLOAD_LOCAL_FILE, () => {
			const requestAlias = 'uploadRequest'
			cy.intercept({ method: 'POST', url: '**/upload' }).as(requestAlias)

			cy.log('Upload the file through the input')
			cy.get('.menubar input[type="file"]').attachFile('table.png')

			waitForRequestAndCheckImage(requestAlias)
		})
	})

	it('test if image files are in the attachment folder', () => {
		// check we stored the image names/ids
		cy.expect(Object.keys(attachmentFileNameToId)).to.have.lengthOf(2)

		cy.get(`#fileList tr[data-file="test.md"]`, { timeout: 10000 })
			.should('have.attr', 'data-id')
			.then((documentId) => {
				cy.intercept({ method: 'PROPFIND', url: '**/.attachments.' + documentId }).as('chdir')
				cy.openFile('.attachments.' + documentId)
				cy.wait('@chdir')
				cy.screenshot()
				for (const name in attachmentFileNameToId) {
					cy.get(`#fileList tr[data-file="${name}"]`, { timeout: 10000 })
						.should('exist')
						.should('have.attr', 'data-id')
						.should('eq', String(attachmentFileNameToId[name]))
				}
			})
	})

	it('test if attachment folder is moved with the markdown file', () => {
		cy.intercept({ method: 'MKCOL', url: '**/subFolder' }).as('mkdir')
		cy.createFolder('subFolder')
		cy.wait('@mkdir')

		cy.intercept({ method: 'PROPFIND', url: '**/' }).as('reload')
		cy.reloadFileList()
		cy.wait('@reload')

		cy.intercept({ method: 'MOVE', url: '**/test.md' }).as('move')
		cy.moveFile('test.md', 'subFolder/test.md')
		cy.wait('@move')
		cy.intercept({ method: 'PROPFIND', url: '**/subFolder' }).as('chdir')
		cy.openFile('subFolder')
		cy.wait('@chdir')

		cy.get(`#fileList tr[data-file="test.md"]`, { timeout: 10000 })
			.should('exist')
			.should('have.attr', 'data-id')
			.then((documentId) => {
				cy.intercept({ method: 'PROPFIND', url: '**/.attachments.' + documentId }).as('chdir')
				cy.openFile('.attachments.' + documentId)
				cy.wait('@chdir')
				cy.screenshot()
				for (const name in attachmentFileNameToId) {
					cy.get(`#fileList tr[data-file="${name}"]`, { timeout: 10000 })
						.should('exist')
						.should('have.attr', 'data-id')
						.should('eq', String(attachmentFileNameToId[name]))
				}
			})
	})

	it('test if attachment folder is copied when copying a markdown file', () => {
		cy.intercept({ method: 'COPY', url: '**/subFolder/test.md' }).as('copyFile')
		cy.copyFile('subFolder/test.md', 'testCopied.md')
		cy.wait('@copyFile')
		cy.intercept({ method: 'PROPFIND', url: '**/' }).as('reload2')
		cy.reloadFileList()
		cy.wait('@reload2')

		cy.get(`#fileList tr[data-file="testCopied.md"]`, { timeout: 10000 })
			.should('exist')
			.should('have.attr', 'data-id')
			.then((documentId) => {
				cy.intercept({ method: 'PROPFIND', url: '**/.attachments.' + documentId }).as('chdir')
				cy.openFile('.attachments.' + documentId)
				cy.wait('@chdir')
				cy.screenshot()
				for (const name in attachmentFileNameToId) {
					cy.get(`#fileList tr[data-file="${name}"]`, { timeout: 10000 })
						.should('exist')
						.should('have.attr', 'data-id')
						// these are new copied attachment files
						// so they should not have the same IDs than the ones created when uploading the images
						.should('not.eq', String(attachmentFileNameToId[name]))
				}
			})
	})

	it('test if attachment folder is deleted after having deleted a markdown file', () => {
		cy.get(`#fileList tr[data-file="testCopied.md"]`, { timeout: 10000 })
			.should('exist')
			.should('have.attr', 'data-id')
			.then((documentId) => {
				cy.intercept({ method: 'DELETE', url: '**/testCopied.md' }).as('deleteFile')
				cy.deleteFile('testCopied.md')
				cy.wait('@deleteFile')

				cy.intercept({ method: 'PROPFIND', url: '**/' }).as('reload3')
				cy.reloadFileList()
				cy.wait('@reload3')

				// cy.wait(2000)
				cy.get(`#fileList tr[data-file=".attachments.${documentId}"]`, { timeout: 10000 })
					.should('not.exist')
			})
		// change the current user for next tests
		currentUser = randUser2
	})

	it('[share] check everything behaves correctly on the share target user side', () => {
		// check the file list
		cy.get('#fileList tr[data-file="test.md"]', { timeout: 10000 })
			.should('contain', 'test.md')
		cy.get('#fileList tr[data-file="github.png"]').should('not.exist')

		// show hidden files
		cy.get('#app-settings-header', { timeout: 10000 })
			.click()
		cy.intercept({ method: 'POST', url: '**/showhidden' }).as('showHidden')
		cy.get('#app-settings-content label[for=showhiddenfilesToggle]', { timeout: 10000 })
			.click()
		cy.wait('@showHidden')

		// check the attachment folder is not there
		cy.get(`#fileList tr[data-file="test.md"]`, { timeout: 10000 })
			.should('exist')
			.should('have.attr', 'data-id')
			.then((documentId) => {
				cy.get(`#fileList tr[data-file=".attachments.${documentId}"]`, { timeout: 10000 })
					.should('not.exist')
			})

		// move the file and check the attachment folder is still not there
		cy.intercept({ method: 'MOVE', url: '**/test.md' }).as('move')
		cy.moveFile('test.md', 'testMoved.md')
		cy.wait('@move')

		cy.intercept({ method: 'PROPFIND', url: '**/' }).as('reload')
		cy.reloadFileList()
		cy.wait('@reload')

		cy.get(`#fileList tr[data-file="testMoved.md"]`, { timeout: 10000 })
			.should('exist')
			.should('have.attr', 'data-id')
			.then((documentId) => {
				cy.get(`#fileList tr[data-file=".attachments.${documentId}"]`, { timeout: 10000 })
					.should('not.exist')
			})

		// copy the file and check the attachment folder was copied
		cy.intercept({ method: 'COPY', url: '**/testMoved.md' }).as('copyFile')
		cy.copyFile('testMoved.md', 'testCopied.md')
		cy.wait('@copyFile')
		cy.intercept({ method: 'PROPFIND', url: '**/' }).as('reload2')
		cy.reloadFileList()
		cy.wait('@reload2')

		cy.get(`#fileList tr[data-file="testCopied.md"]`, { timeout: 10000 })
			.should('exist')
			.should('have.attr', 'data-id')
			.then((documentId) => {
				cy.intercept({ method: 'PROPFIND', url: '**/.attachments.' + documentId }).as('chdir')
				cy.openFile('.attachments.' + documentId)
				cy.wait('@chdir')
				cy.screenshot()
				for (const name in attachmentFileNameToId) {
					cy.get(`#fileList tr[data-file="${name}"]`, { timeout: 10000 })
						.should('exist')
						.should('have.attr', 'data-id')
						// these are new copied attachment files
						// so they should not have the same IDs than the ones created when uploading the images
						.should('not.eq', String(attachmentFileNameToId[name]))
				}
			})
	})

	it('Delete the user', () => {
		cy.nextcloudDeleteUser(randUser, 'password')
		cy.nextcloudDeleteUser(randUser2, 'password')
	})

})
