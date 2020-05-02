/*-----------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat, Inc. All rights reserved.
 *  Licensed under the MIT License. See LICENSE file in the project root for license information.
 *-----------------------------------------------------------------------------------------------*/

import { TreeItemCollapsibleState, window } from 'vscode';
import { Subject } from 'rxjs';
import * as validator from 'validator';
import { KnativeTreeEvent, KnativeEvent } from './knativeTreeEvent';
import { KnativeTreeModel } from './knativeTreeModel';
import { KnativeTreeObject, compareNodes, TreeObject } from './knativeTreeObject';
import { ContextType } from '../kn/config';
import { KnAPI } from '../kn/kn-api';
import { KnativeServices } from '../knative/knativeServices';
import { execute, loadItems } from '../kn/knExecute';
import { CliExitData } from '../kn/knCli';
import { Service, CreateService } from '../knative/service';
import { Revision } from '../knative/revision';

// import bs = require('binary-search');

/**
 * Insert a knative object into the array of knative objects.
 *
 * @param array
 * @param item
 * @returns knative object being added to the array
 */
// function insert(array: KnativeObject[], item: KnativeObject): KnativeObject {
//   const i = bs(array, item, compareNodes);
//   array.splice(Math.abs(i) - 1, 0, item);
//   return item;
// }

// function askUserForValue(prompt: string, placeHolder?: string): Thenable<string> {
//   const options: InputBoxOptions = {
//       prompt,
//       placeHolder
//   }

//   const input: Thenable<string> = window.showInputBox(options).then((value) => {
//     if (!value) {return;}
//     return value;
//   })

//   return input
// }

export class KnController {
  private static instance: KnController;

  // eslint-disable-next-line no-useless-constructor
  private constructor() {
    // do something if needed, but this is private for the singleton
  }

  public static get Instance(): KnController {
    // eslint-disable-next-line no-console
    console.log(`knController.Instance`);
    if (!KnController.instance) {
      KnController.instance = new KnController();
    }
    return KnController.instance;
  }

  private ksvc: KnativeServices = KnativeServices.Instance;

  private subjectInstance: Subject<KnativeEvent> = new Subject<KnativeEvent>();

  private readonly knLoginMessages = [
    'Please log in to the cluster',
    'the server has asked for the client to provide credentials',
    'Please login to your server',
    'Unauthorized',
  ];

  public data: KnativeTreeModel = new KnativeTreeModel();

  public static ROOT: TreeObject = new KnativeTreeObject(undefined, undefined, '/', undefined, false, undefined);

  get subject(): Subject<KnativeEvent> {
    // eslint-disable-next-line no-console
    console.log(`knController.subject`);
    return this.subjectInstance;
  }

  /**
   * The Revision is a child of Service. Every update makes a new Revision.
   * Fetch the Revisions and associate them with their parent Services.
   */
  public async getRevisions(parentServices: TreeObject[]): Promise<TreeObject[]> {
    // const services: Service[] = this.ksvc.getServices();
    // eslint-disable-next-line no-console
    console.log(`knController.getRevisions start`);

    // get all the revisions for this namespace
    const revisionTreeObjects: TreeObject[] = await this._getRevisions(parentServices);
    // iterate through the revisions and add them to their parents
    parentServices.forEach((parentTreeObject) => {
      const childTreeObjects: TreeObject[] = [];
      revisionTreeObjects.forEach((value) => {
        // pull the Revision from the TreeObject
        const revision: Revision = value.getKnativeItem() as Revision;

        if (parentTreeObject.getName() === revision.service) {
          childTreeObjects.push(value);
        }
      });

      this.data.setParentToChildren(parentTreeObject, childTreeObjects);
    });
    // eslint-disable-next-line no-console
    console.log(`knController.getRevisions end`);

    return revisionTreeObjects;
  }

  private async _getRevisions(parentServices: TreeObject[]): Promise<TreeObject[]> {
    // eslint-disable-next-line no-console
    console.log(`knController._getRevisions start`);
    // Get the raw data from the cli call.
    const result: CliExitData = await execute(KnAPI.listRevisions());
    const revisions: Revision[] = this.ksvc.addRevisions(loadItems(result).map((value) => Revision.toRevision(value)));

    if (revisions.length === 0) {
      // If there are no Revisions then there is either no Service or an error.
      return;
    }

    // Create the Service tree item for each one found.
    const revisionTreeObjects: TreeObject[] = revisions
      .map<TreeObject>((value) => {
        // eslint-disable-next-line no-console
        console.log(`knController._getRevisions value.name ${value.name}`);
        const parent: TreeObject = parentServices.find((svc): boolean => {
          return svc.getName() === value.service;
        });
        const obj: TreeObject = new KnativeTreeObject(
          parent,
          value,
          value.name,
          ContextType.REVISION,
          false,
          TreeItemCollapsibleState.Collapsed,
          null,
          null,
        );
        // this.data.setPathToObject(obj);
        return obj;
      })
      .sort(compareNodes);
    // eslint-disable-next-line no-console
    console.log(`knController._getRevisions end`);

    return revisionTreeObjects;
  }

  /**
   * The Service is the highest level of the tree for Knative. This method sets it at the root if not already done.
   */
  public async getServices(): Promise<TreeObject[]> {
    // eslint-disable-next-line no-console
    console.log(`knController.getServices start`);
    // If the ROOT has already been set then return it.
    // If not then the initial undefined version is returned.
    let children = this.data.getChildrenByParent(KnController.ROOT);
    // IF there is no ROOT then get the services and make them the ROOT.
    if (!children) {
      children = this.data.setParentToChildren(KnController.ROOT, await this._getServices());
    }
    // TODO: to use the above, we need to update the data in the modle completely, when things are updated or added
    // const children = this.data.setParentToChildren(KnController.ROOT, await this._getServices());

    if (children.length === 1 && children[0].label === 'No Service Found') {
      return children;
    }
    await this.getRevisions(children);
    // eslint-disable-next-line no-console
    console.log(`knController.getServices end`);
    return children;
  }

  private async _getServices(): Promise<TreeObject[]> {
    // eslint-disable-next-line no-console
    console.log(`knController._getServices start`);
    // Get the raw data from the cli call.
    const result: CliExitData = await execute(KnAPI.listServices());
    const services: Service[] = this.ksvc.addServices(loadItems(result).map((value) => Service.toService(value)));
    // Pull out the name of the service from the raw data.
    // Create an empty state message when there is no Service.
    if (services.length === 0) {
      // eslint-disable-next-line no-console
      console.log(`knController._getServices services.length = ${services.length}`);
      return [
        new KnativeTreeObject(
          null,
          null,
          'No Service Found',
          ContextType.SERVICE,
          false,
          TreeItemCollapsibleState.Collapsed,
          null,
          null,
        ),
      ];
    }
    // Create the Service tree item for each one found.
    return services
      .map<TreeObject>((value) => {
        // eslint-disable-next-line no-console
        console.log(`knController._getServices value.name = ${value.name}`);
        const obj: TreeObject = new KnativeTreeObject(
          null,
          value,
          value.name,
          ContextType.SERVICE,
          false,
          TreeItemCollapsibleState.Expanded,
          null,
          null,
        );
        // eslint-disable-next-line no-console
        console.log(`knController._getServices obj.name = ${obj.getName()}`);
        this.data.setPathToObject(obj);
        // eslint-disable-next-line no-console
        console.log(`knController._getServices end`);
        return obj;
      })
      .sort(compareNodes);
  }

  // private async insertAndReveal(item: KnativeObject): Promise<KnativeObject> {
  //   // await OpenShiftExplorer.getInstance().reveal(this.insert(await item.getParent().getChildren(), item));
  //   this.subject.next(
  //     new KnatvieTreeEvent('inserted', insert(await item.getParent().getChildren(), item), true),
  //   );
  //   return item;
  // }

  // eslint-disable-next-line class-methods-use-this
  // private async insertAndRevealService(item: TreeObject): Promise<TreeObject> {
  //   await ServiceExplorer.reveal(item);
  //   return item;
  // }

  // private async insertAndRefresh(item: KnativeObject): Promise<KnativeObject> {
  //   // await OpenShiftExplorer.getInstance().refresh(this.insert(await item.getParent().getChildren(), item).getParent());
  //   this.subject.next(
  //     new KnatvieTreeEvent(
  //       'changed',
  //       insert(await item.getParent().getChildren(), item).getParent(),
  //     ),
  //   );
  //   return item;
  // }

  private async deleteAndRefresh(item: TreeObject): Promise<TreeObject> {
    await this.data.delete(item);
    // OpenShiftExplorer.getInstance().refresh(item.getParent());
    this.subject.next(new KnativeTreeEvent('changed', item.getParent()));
    return item;
  }

  public async deleteService(service: TreeObject): Promise<TreeObject> {
    await execute(KnAPI.deleteServices(service.getName()));
    return this.deleteAndRefresh(service);
  }

  // eslint-disable-next-line class-methods-use-this
  validateUrl(message: string, value: string): string | null {
    return validator.default.isURL(value) ? null : message;
  }

  // eslint-disable-next-line class-methods-use-this
  async getUrl(): Promise<string | null> {
    // const createUrl: QuickPickItem = { label: `$(plus) Provide new URL...` };
    // const clusterItems: QuickPickItem[] = [{ label: 'invinciblejai/tag-portal-v1' }];
    // const choice = await window.showQuickPick([createUrl, ...clusterItems], {
    //   placeHolder: 'Provide Image URL to connect',
    //   ignoreFocusOut: true,
    // });
    // if (!choice) {
    //   return null;
    // }
    // return choice.label === createUrl.label
    //   ? window.showInputBox({
    //       ignoreFocusOut: true,
    //       prompt: 'Enter an Image URL',
    //       validateInput: (value: string) => KnController.validateUrl('Invalid URL provided', value),
    //     })
    //   : choice.label;
    return window.showInputBox({
      ignoreFocusOut: true,
      prompt: 'Enter an Image URL',
      // validateInput: (value: string) => KnController.validateUrl('Invalid URL provided', value),
    });
  }

  // eslint-disable-next-line class-methods-use-this
  async getName(image: string): Promise<CreateService | null> {
    const imageSplit: string[] = image.split('/');
    const imageName: string = imageSplit[imageSplit.length - 1];
    let force = false;

    const name: string = await window.showInputBox({
      value: imageName,
      ignoreFocusOut: true,
      prompt: 'Enter a Name for the Service',
      validateInput: async (nameUsed: string) => {
        const found: Service = this.ksvc.findServices(nameUsed);
        if (found) {
          const response = await window.showInformationMessage(
            `That name has already been used. Do you want to overwrite the Service?`,
            { modal: true },
            'Yes',
            'No',
          );
          if (response === 'Yes') {
            force = true;
            return null;
          }
          return 'Please use a unique name.';
        }
        return null;
      },
    });
    if (!name) {
      return null;
    }
    if (name === imageName && !force) {
      return null;
    }
    const service: CreateService = { name, image, force };
    return service;
  }

  public async addService(): Promise<TreeObject[]> {
    const image: string = await this.getUrl();

    if (!image) {
      return null;
    }

    const servObj: CreateService = await this.getName(image);

    if (!servObj.name) {
      return null;
    }

    // Get the raw data from the cli call.
    const result: CliExitData = await execute(KnAPI.createService(servObj));
    const service: Service = new Service(servObj.name, servObj.image);

    this.ksvc.addService(service);

    if (result.error) {
      // TODO: handle the error
      // check the kind of errors we can get back
    }
    const createKnObj = (value: Service): TreeObject => {
      const obj: TreeObject = new KnativeTreeObject(
        null,
        value,
        value.name,
        ContextType.SERVICE,
        false,
        TreeItemCollapsibleState.Expanded,
      );
      // eslint-disable-next-line no-console
      console.log(`knController.addService obj.name = ${obj.getName()}`);
      this.data.setPathToObject(obj);
      return obj;
    };
    const child: TreeObject = createKnObj(service);
    const parent = this.data.addChildToParent(child, KnController.ROOT);
    return parent;
    // return this.insertAndRevealService(createKnObj(servObj.name));
  }

  public async requireLogin(): Promise<boolean> {
    const result: CliExitData = await execute(KnAPI.printKnVersion(), process.cwd(), false);
    return this.knLoginMessages.some((msg) => result.stderr.includes(msg));
  }

  // eslint-disable-next-line class-methods-use-this
  clearCache(): void {
    this.data.clearTreeData();
  }
}

export function getInstance(): KnController {
  return KnController.Instance;
}
